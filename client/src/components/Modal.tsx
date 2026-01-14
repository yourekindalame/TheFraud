import React from "react";

export function Modal({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modalHeader">
          <h2 style={{ fontWeight: 900, margin: 0 }}>{title}</h2>
          <button className="btn" onClick={onClose} aria-label="Close" style={{ padding: "8px 12px" }}>
            ✕
          </button>
        </div>
        <div className="modalBody">{children}</div>
      </div>
    </div>
  );
}

