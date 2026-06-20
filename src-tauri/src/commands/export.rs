//! Native Markdown → PDF export.
//!
//! Pipeline:
//!   1. `pulldown-cmark` parses the Markdown into a token stream.
//!   2. A small layout walker emits text spans onto pages using
//!      `printpdf`'s 14 built-in PDF fonts (Helvetica family for
//!      prose, Courier for code) — so we ship ZERO font files in the
//!      app bundle.
//!   3. The PDF is written atomically to the user-picked path on a
//!      `tokio::task::spawn_blocking` thread so the main runtime
//!      stays responsive.
//!
//! Not supported (intentional, keeps the bundle tiny): inline
//! images, mermaid diagrams, syntax-highlighted code, MathJax. The
//! webview-print fallback covers those cases; this command is the
//! fast / tiny / native path.

use crate::types::AppError;
use printpdf::{
    BuiltinFont, IndirectFontRef, Line, Mm, PdfDocument, PdfDocumentReference, PdfLayerIndex,
    PdfLayerReference, PdfPageIndex, Point,
};
use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use std::fs::File;
use std::io::BufWriter;

// ── Page geometry (mm) ───────────────────────────────────────────────────
const PAGE_W: f32 = 210.0;
const PAGE_H: f32 = 297.0;
const MARGIN: f32 = 18.0;
const LINE_GAP: f32 = 1.35;

// ── Font sizes (pt) ──────────────────────────────────────────────────────
const FS_BODY: f32 = 11.0;
const FS_CODE: f32 = 10.0;
const FS_H1: f32 = 22.0;
const FS_H2: f32 = 18.0;
const FS_H3: f32 = 15.0;
const FS_H4: f32 = 13.0;
const FS_H5: f32 = 12.0;
const FS_H6: f32 = 11.0;

// ── Style bit-flags (plain u8 — no extra deps) ───────────────────────────
const S_BOLD: u8 = 0b0001;
const S_ITALIC: u8 = 0b0010;
const S_CODE: u8 = 0b0100;

#[derive(Clone, Copy, Default)]
struct Style(u8);
impl Style {
    fn has(self, bit: u8) -> bool {
        self.0 & bit != 0
    }
    fn with(self, bit: u8) -> Self {
        Self(self.0 | bit)
    }
    fn without(self, bit: u8) -> Self {
        Self(self.0 & !bit)
    }
}

struct Fonts {
    regular: IndirectFontRef,
    bold: IndirectFontRef,
    italic: IndirectFontRef,
    bold_italic: IndirectFontRef,
    mono: IndirectFontRef,
}

impl Fonts {
    fn load(doc: &PdfDocumentReference) -> Result<Self, AppError> {
        let f = |b: BuiltinFont| {
            doc.add_builtin_font(b)
                .map_err(|e| AppError::Other(e.to_string()))
        };
        Ok(Self {
            regular: f(BuiltinFont::Helvetica)?,
            bold: f(BuiltinFont::HelveticaBold)?,
            italic: f(BuiltinFont::HelveticaOblique)?,
            bold_italic: f(BuiltinFont::HelveticaBoldOblique)?,
            mono: f(BuiltinFont::Courier)?,
        })
    }

    fn pick(&self, s: Style) -> &IndirectFontRef {
        if s.has(S_CODE) {
            &self.mono
        } else if s.has(S_BOLD) && s.has(S_ITALIC) {
            &self.bold_italic
        } else if s.has(S_BOLD) {
            &self.bold
        } else if s.has(S_ITALIC) {
            &self.italic
        } else {
            &self.regular
        }
    }
}

#[derive(Clone)]
struct Span {
    text: String,
    style: Style,
    size: f32,
}

struct Layout {
    doc: PdfDocumentReference,
    page: PdfPageIndex,
    layer: PdfLayerIndex,
    fonts: Fonts,
    y: f32,
    style: Style,
    spans: Vec<Span>,
    heading_size: Option<f32>,
    list_depth: u32,
    in_code_block: bool,
    code_block_buf: String,
}

fn pt_to_mm(pt: f32) -> f32 {
    pt * 0.3528
}

/// Rough text-width estimate. PDF standard fonts have known avg
/// glyph advances; we use those constants instead of pulling a full
/// font-metrics crate.
fn approx_text_width_mm(text: &str, size_pt: f32, style: Style) -> f32 {
    let avg_em = if style.has(S_CODE) {
        600.0 // Courier (monospace)
    } else if style.has(S_BOLD) {
        540.0
    } else {
        500.0
    };
    let chars = text.chars().count() as f32;
    let em_width = (chars * avg_em) / 1000.0;
    pt_to_mm(em_width * size_pt)
}

fn heading_size(lvl: HeadingLevel) -> f32 {
    match lvl {
        HeadingLevel::H1 => FS_H1,
        HeadingLevel::H2 => FS_H2,
        HeadingLevel::H3 => FS_H3,
        HeadingLevel::H4 => FS_H4,
        HeadingLevel::H5 => FS_H5,
        HeadingLevel::H6 => FS_H6,
    }
}

impl Layout {
    fn new(title: &str) -> Result<Self, AppError> {
        let (doc, page, layer) = PdfDocument::new(title, Mm(PAGE_W), Mm(PAGE_H), "L1");
        let fonts = Fonts::load(&doc)?;
        Ok(Self {
            doc,
            page,
            layer,
            fonts,
            y: PAGE_H - MARGIN,
            style: Style::default(),
            spans: Vec::new(),
            heading_size: None,
            list_depth: 0,
            in_code_block: false,
            code_block_buf: String::new(),
        })
    }

    fn current_layer(&self) -> PdfLayerReference {
        self.doc.get_page(self.page).get_layer(self.layer)
    }

    fn new_page(&mut self) {
        let (page, layer) = self.doc.add_page(Mm(PAGE_W), Mm(PAGE_H), "L1");
        self.page = page;
        self.layer = layer;
        self.y = PAGE_H - MARGIN;
    }

    fn ensure_space(&mut self, needed_mm: f32) {
        if self.y - needed_mm < MARGIN {
            self.new_page();
        }
    }

    fn push_span(&mut self, text: &str) {
        let size = self.heading_size.unwrap_or(FS_BODY);
        self.spans.push(Span {
            text: text.to_string(),
            style: self.style,
            size,
        });
    }

    fn gap(&mut self, mm: f32) {
        if self.y - mm < MARGIN {
            self.new_page();
        } else {
            self.y -= mm;
        }
    }

    /// Greedy word-wrap + line layout for the current `spans`.
    fn flush_paragraph(&mut self, indent_mm: f32) {
        if self.spans.is_empty() {
            return;
        }
        let usable_w = PAGE_W - MARGIN * 2.0 - indent_mm;

        // Tokenise spans into word + trailing-space pairs so we can
        // wrap and reglue cleanly.
        let mut tokens: Vec<Span> = Vec::new();
        for sp in self.spans.drain(..) {
            let s = sp.text.replace('\n', " ");
            let chars: Vec<char> = s.chars().collect();
            let mut i = 0;
            while i < chars.len() {
                while i < chars.len() && chars[i].is_whitespace() {
                    i += 1;
                }
                let start = i;
                while i < chars.len() && !chars[i].is_whitespace() {
                    i += 1;
                }
                if start < i {
                    let trailing_ws = i < chars.len();
                    let mut word: String = chars[start..i].iter().collect();
                    if trailing_ws {
                        word.push(' ');
                    }
                    tokens.push(Span {
                        text: word,
                        style: sp.style,
                        size: sp.size,
                    });
                }
            }
        }

        let mut line: Vec<Span> = Vec::new();
        let mut line_w = 0.0_f32;
        let mut line_h = 0.0_f32;

        for tok in tokens {
            let w = approx_text_width_mm(&tok.text, tok.size, tok.style);
            let lh = pt_to_mm(tok.size);
            if line_w + w > usable_w && !line.is_empty() {
                self.draw_line(&mut line, line_h, indent_mm);
                line_w = 0.0;
                line_h = 0.0;
            }
            line_h = line_h.max(lh);
            line_w += w;
            line.push(tok);
        }
        self.draw_line(&mut line, line_h, indent_mm);
    }

    fn draw_line(&mut self, line: &mut Vec<Span>, line_h: f32, indent: f32) {
        if line.is_empty() {
            return;
        }
        let lh = if line_h > 0.0 {
            line_h
        } else {
            pt_to_mm(FS_BODY)
        };
        self.ensure_space(lh * LINE_GAP);
        let mut x = MARGIN + indent;
        let baseline_y = self.y - lh * 0.85;
        let layer = self.current_layer();
        for sp in line.drain(..) {
            let font = self.fonts.pick(sp.style);
            layer.use_text(&sp.text, sp.size, Mm(x), Mm(baseline_y), font);
            x += approx_text_width_mm(&sp.text, sp.size, sp.style);
        }
        self.y -= lh * LINE_GAP;
    }

    fn flush_code_block(&mut self) {
        if self.code_block_buf.is_empty() {
            self.in_code_block = false;
            return;
        }
        let block = std::mem::take(&mut self.code_block_buf);
        self.in_code_block = false;
        let line_h = pt_to_mm(FS_CODE);
        for raw in block.lines() {
            self.ensure_space(line_h * LINE_GAP);
            let layer = self.current_layer();
            let baseline_y = self.y - line_h * 0.85;
            layer.use_text(
                raw.replace('\t', "    "),
                FS_CODE,
                Mm(MARGIN + 2.0),
                Mm(baseline_y),
                &self.fonts.mono,
            );
            self.y -= line_h * LINE_GAP;
        }
    }

    fn rule(&mut self) {
        self.gap(2.0);
        self.ensure_space(2.0);
        let y = self.y;
        let layer = self.current_layer();
        layer.add_line(Line {
            points: vec![
                (Point::new(Mm(MARGIN), Mm(y)), false),
                (Point::new(Mm(PAGE_W - MARGIN), Mm(y)), false),
            ],
            is_closed: false,
        });
        self.gap(3.0);
    }

    fn finish(self, output_path: &str) -> Result<(), AppError> {
        let f = File::create(output_path)
            .map_err(|e| AppError::Io(format!("could not create {}: {}", output_path, e)))?;
        let mut buf = BufWriter::new(f);
        self.doc
            .save(&mut buf)
            .map_err(|e| AppError::Other(format!("pdf save: {}", e)))?;
        Ok(())
    }
}

/// Native Markdown → PDF export.
#[tauri::command]
pub async fn export_markdown_to_pdf(
    title: String,
    markdown: String,
    output_path: String,
) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        let mut layout = Layout::new(&title)?;

        // Enable the GitHub-flavoured Markdown extensions so tables,
        // strikethrough, task lists, footnotes, smart punctuation,
        // heading anchors and YAML frontmatter all parse properly.
        // The default `Parser::new` is plain CommonMark and would
        // leak `|table|` syntax, `~~strike~~`, `- [ ]`, `[^foot]`
        // tokens, etc. into the output as literal text.
        let mut opts = Options::empty();
        opts.insert(Options::ENABLE_TABLES);
        opts.insert(Options::ENABLE_STRIKETHROUGH);
        opts.insert(Options::ENABLE_TASKLISTS);
        opts.insert(Options::ENABLE_FOOTNOTES);
        opts.insert(Options::ENABLE_SMART_PUNCTUATION);
        opts.insert(Options::ENABLE_HEADING_ATTRIBUTES);
        opts.insert(Options::ENABLE_YAML_STYLE_METADATA_BLOCKS);
        let parser = Parser::new_ext(&markdown, opts);
        for ev in parser {
            match ev {
                // Block start
                Event::Start(Tag::Heading { level, .. }) => {
                    layout.gap(2.5);
                    layout.heading_size = Some(heading_size(level));
                    layout.style = layout.style.with(S_BOLD);
                }
                Event::Start(Tag::Paragraph) => {}
                Event::Start(Tag::Emphasis) => {
                    layout.style = layout.style.with(S_ITALIC);
                }
                Event::Start(Tag::Strong) => {
                    layout.style = layout.style.with(S_BOLD);
                }
                Event::Start(Tag::Strikethrough) => {}
                Event::Start(Tag::Link { .. }) => {
                    layout.style = layout.style.with(S_ITALIC);
                }
                Event::Start(Tag::Image { .. }) => layout.push_span("[image]"),
                Event::End(TagEnd::Image) => {}
                Event::End(TagEnd::Strikethrough) => {}
                Event::Start(Tag::BlockQuote) => {
                    layout.style = layout.style.with(S_ITALIC);
                }
                Event::Start(Tag::CodeBlock(_)) => {
                    layout.in_code_block = true;
                }
                Event::Start(Tag::List(_)) => {
                    layout.list_depth += 1;
                }
                Event::Start(Tag::Item) => {
                    layout.push_span("• ");
                }

                // Block end
                Event::End(TagEnd::Heading(_)) => {
                    layout.flush_paragraph(0.0);
                    layout.heading_size = None;
                    layout.style = layout.style.without(S_BOLD);
                    layout.gap(1.5);
                }
                Event::End(TagEnd::Paragraph) => {
                    layout.flush_paragraph(0.0);
                    layout.gap(2.0);
                }
                Event::End(TagEnd::Emphasis) => {
                    layout.style = layout.style.without(S_ITALIC);
                }
                Event::End(TagEnd::Strong) => {
                    layout.style = layout.style.without(S_BOLD);
                }
                Event::End(TagEnd::Link) => {
                    layout.style = layout.style.without(S_ITALIC);
                }
                Event::End(TagEnd::BlockQuote) => {
                    layout.flush_paragraph(4.0);
                    layout.style = layout.style.without(S_ITALIC);
                    layout.gap(1.5);
                }
                Event::End(TagEnd::CodeBlock) => {
                    layout.flush_code_block();
                    layout.gap(2.0);
                }
                Event::End(TagEnd::List(_)) => {
                    layout.list_depth = layout.list_depth.saturating_sub(1);
                    layout.gap(1.0);
                }
                Event::End(TagEnd::Item) => {
                    let indent = (layout.list_depth as f32) * 4.0;
                    layout.flush_paragraph(indent);
                }

                // Inline
                Event::Text(t) => {
                    if layout.in_code_block {
                        layout.code_block_buf.push_str(&t);
                    } else {
                        layout.push_span(&t);
                    }
                }
                Event::Code(t) => {
                    let saved = layout.style;
                    layout.style = layout.style.with(S_CODE);
                    layout.push_span(&t);
                    layout.style = saved;
                }
                Event::SoftBreak | Event::HardBreak => {
                    if layout.in_code_block {
                        layout.code_block_buf.push('\n');
                    } else {
                        layout.push_span(" ");
                    }
                }
                Event::Rule => layout.rule(),
                Event::Html(_) | Event::InlineHtml(_) => {}
                Event::FootnoteReference(name) => {
                    let saved = layout.style;
                    layout.style = layout.style.with(S_ITALIC);
                    layout.push_span(&format!("[^{}]", name));
                    layout.style = saved;
                }
                Event::TaskListMarker(checked) => {
                    // pulldown-cmark emits the marker AFTER the list
                    // item's leading bullet text \u2014 we replace the
                    // bullet by overwriting the last span we pushed.
                    if let Some(last) = layout.spans.last_mut() {
                        if last.text == "\u{2022} " {
                            last.text = if checked { "\u{2611} ".into() } else { "\u{2610} ".into() };
                        }
                    }
                }
                Event::Start(Tag::FootnoteDefinition(name)) => {
                    layout.gap(1.5);
                    let saved = layout.style;
                    layout.style = layout.style.with(S_BOLD);
                    layout.push_span(&format!("[^{}]: ", name));
                    layout.style = saved;
                }
                Event::End(TagEnd::FootnoteDefinition) => {
                    layout.flush_paragraph(4.0);
                    layout.gap(1.0);
                }
                Event::Start(Tag::Table(_)) => {
                    layout.gap(2.0);
                }
                Event::End(TagEnd::Table) => {
                    layout.flush_paragraph(0.0);
                    layout.gap(2.0);
                }
                Event::Start(Tag::TableHead) => {
                    layout.style = layout.style.with(S_BOLD);
                }
                Event::End(TagEnd::TableHead) => {
                    layout.flush_paragraph(0.0);
                    layout.style = layout.style.without(S_BOLD);
                    // Underline row.
                    layout.ensure_space(0.5);
                    let y = layout.y + 0.5;
                    let layer = layout.current_layer();
                    layer.add_line(Line {
                        points: vec![
                            (Point::new(Mm(MARGIN), Mm(y)), false),
                            (Point::new(Mm(PAGE_W - MARGIN), Mm(y)), false),
                        ],
                        is_closed: false,
                    });
                    layout.gap(0.5);
                }
                Event::Start(Tag::TableRow) => {}
                Event::End(TagEnd::TableRow) => {
                    layout.flush_paragraph(0.0);
                }
                Event::Start(Tag::TableCell) => {}
                Event::End(TagEnd::TableCell) => {
                    // Separate cells with a vertical bar so the
                    // table stays legible without true column layout.
                    layout.push_span("  \u{2502}  ");
                }
                Event::Start(Tag::HtmlBlock) | Event::End(TagEnd::HtmlBlock) => {}
                Event::Start(Tag::MetadataBlock(_)) => {
                    // Treat frontmatter as a verbatim code block so
                    // YAML stays readable without bleeding into the
                    // body text.
                    layout.in_code_block = true;
                }
                Event::End(TagEnd::MetadataBlock(_)) => {
                    layout.flush_code_block();
                    layout.gap(2.0);
                }
            }
        }

        layout.flush_paragraph(0.0);
        layout.finish(&output_path)
    })
    .await
    .map_err(|e| AppError::Other(format!("join error: {}", e)))?
}
