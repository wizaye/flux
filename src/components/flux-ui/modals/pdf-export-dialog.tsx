/**
 * PDF export options dialog. Surfaces the full `PdfExportOptions`
 * surface (page size, orientation, margins, scale, content toggles)
 * before kicking off `html2pdf.js`. Heavy rendering work happens in
 * the parent's `onExport` callback so the dialog stays a dumb form.
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PDF_OPTIONS,
  type PdfExportOptions,
} from "@/lib/doc-actions";

interface Props {
  open: boolean;
  defaultFilename: string;
  onCancel: () => void;
  onExport: (opts: PdfExportOptions) => Promise<void> | void;
}

export function PdfExportDialog({
  open,
  defaultFilename,
  onCancel,
  onExport,
}: Props) {
  const [opts, setOpts] = React.useState<PdfExportOptions>({
    ...DEFAULT_PDF_OPTIONS,
    filename: defaultFilename,
  });

  React.useEffect(() => {
    if (open) {
      setOpts({ ...DEFAULT_PDF_OPTIONS, filename: defaultFilename });
    }
  }, [open, defaultFilename]);

  const update = <K extends keyof PdfExportOptions>(k: K, v: PdfExportOptions[K]) =>
    setOpts((s) => ({ ...s, [k]: v }));

  const handleExport = () => {
    // Fire-and-forget — the parent wraps the actual work in a
    // sonner toast.promise so the user sees progress / success /
    // failure in the corner. Closing the dialog immediately keeps
    // the UI responsive.
    void onExport(opts);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Export to PDF</DialogTitle>
          <DialogDescription>
            Save the current document as a PDF. Choose the paper size, page
            orientation, margins, and content options before exporting.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2 text-[12px]">
          <Field label="Filename">
            <Input
              value={opts.filename}
              onChange={(e) => update("filename", e.target.value)}
              placeholder="my-document"
            />
          </Field>
          <Field label="Page size">
            <Select
              value={opts.pageSize}
              onValueChange={(v) =>
                update("pageSize", v as PdfExportOptions["pageSize"])
              }
            >
              <SelectTrigger className="h-9 w-full text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="a4">A4</SelectItem>
                <SelectItem value="letter">US Letter</SelectItem>
                <SelectItem value="legal">US Legal</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Orientation">
            <Select
              value={opts.orientation}
              onValueChange={(v) =>
                update("orientation", v as PdfExportOptions["orientation"])
              }
            >
              <SelectTrigger className="h-9 w-full text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="portrait">Portrait</SelectItem>
                <SelectItem value="landscape">Landscape</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={`Margin (${opts.marginMm} mm)`}>
            <Slider
              min={0}
              max={40}
              step={1}
              value={[opts.marginMm]}
              onValueChange={([v]) =>
                v !== undefined && update("marginMm", v)
              }
              className="h-9 flex items-center"
            />
          </Field>

          <Field label={`Quality (scale ${opts.scale}×)`}>
            <Slider
              min={1}
              max={4}
              step={1}
              value={[opts.scale]}
              onValueChange={([v]) =>
                v !== undefined && update("scale", v)
              }
              className="h-9 flex items-center"
            />
          </Field>
          <Field label="Background">
            <RadioGroup
              value={opts.darkBackground ? "dark" : "light"}
              onValueChange={(v) => update("darkBackground", v === "dark")}
              className="flex items-center gap-2 h-9"
            >
              {(["light", "dark"] as const).map((opt) => (
                <label
                  key={opt}
                  htmlFor={`pdf-bg-${opt}`}
                  className={cn(
                    "flex-1 h-full flex items-center justify-center rounded-md border text-[12px] cursor-pointer capitalize select-none",
                    (opts.darkBackground ? "dark" : "light") === opt
                      ? "bg-accent text-accent-foreground border-accent"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/40",
                  )}
                >
                  <RadioGroupItem
                    id={`pdf-bg-${opt}`}
                    value={opt}
                    className="sr-only"
                  />
                  {opt}
                </label>
              ))}
            </RadioGroup>
          </Field>

          <label
            htmlFor="pdf-include-diagrams"
            className="flex items-center gap-2 cursor-pointer col-span-2 py-1 select-none"
          >
            <Checkbox
              id="pdf-include-diagrams"
              checked={opts.includeDiagrams}
              onCheckedChange={(v) => update("includeDiagrams", v === true)}
            />
            <span>Include Mermaid diagrams</span>
          </label>
          <label
            htmlFor="pdf-include-code"
            className="flex items-center gap-2 cursor-pointer col-span-2 py-1 select-none"
          >
            <Checkbox
              id="pdf-include-code"
              checked={opts.includeCode}
              onCheckedChange={(v) => update("includeCode", v === true)}
            />
            <span>Include syntax-highlighted code blocks</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={!opts.filename.trim()}>
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--text-muted)]">{label}</span>
      {children}
    </div>
  );
}
