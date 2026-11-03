import { useRef, useState, type TextareaHTMLAttributes, type Ref } from "react";
/** Vertical resizing without a native grip; mouse, touch and keyboard supported. */
export default function ResizableTextarea({
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const [height, setHeight] = useState<number>();
  const drag = useRef<{ y: number; height: number } | null>(null);
  const clamp = (value: number) =>
    Math.max(64, Math.min(Math.max(180, innerHeight * 0.65), value));
  return (
    <div className="resizable-field">
      <textarea
        {...props}
        ref={(node) => {
          area.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        style={{ ...props.style, ...(height ? { height } : {}) }}
      />
      <span
        role="separator"
        aria-label="Resize application field"
        aria-orientation="horizontal"
        aria-valuemin={64}
        aria-valuemax={Math.max(180, innerHeight * 0.65)}
        aria-valuenow={height || 64}
        tabIndex={0}
        className="field-resize-handle"
        onPointerDown={(e) => {
          e.preventDefault();
          drag.current = {
            y: e.clientY,
            height: area.current!.getBoundingClientRect().height,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setHeight(clamp(drag.current.height + e.clientY - drag.current.y));
        }}
        onPointerUp={(e) => {
          drag.current = null;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(e) => {
          if (["ArrowUp", "ArrowDown", "Home"].includes(e.key)) {
            e.preventDefault();
            setHeight(
              clamp(
                e.key === "Home"
                  ? 64
                  : (area.current?.getBoundingClientRect().height || 64) +
                      (e.key === "ArrowDown" ? 24 : -24),
              ),
            );
          }
        }}
      />
    </div>
  );
}
