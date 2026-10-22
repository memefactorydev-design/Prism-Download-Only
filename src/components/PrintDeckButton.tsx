"use client";

export function PrintDeckButton() {
  return (
    <button onClick={() => window.print()} className="btn btn-primary">
      Download PDF
    </button>
  );
}
