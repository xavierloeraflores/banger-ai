"use client";

import { forwardRef, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";

function classes(...values: (string | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", type = "button", className, ...props }, ref,
) {
  return <button {...props} ref={ref} type={type} className={classes("banger-button", `banger-button--${variant}`, className)} />;
});

export type IconButtonProps = ButtonProps & { "aria-label": string };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, ...props }, ref,
) {
  return <Button {...props} ref={ref} className={classes("banger-icon-button", className)} />;
});

export type PanelProps = ComponentPropsWithoutRef<"section">;

export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { className, ...props }, ref,
) {
  return <section {...props} ref={ref} className={classes("banger-panel", className)} />;
});

export type InputProps = ComponentPropsWithoutRef<"input">;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props }, ref,
) {
  return <input {...props} ref={ref} className={classes("banger-input", className)} />;
});

export type SelectProps = ComponentPropsWithoutRef<"select">;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props }, ref,
) {
  return <select {...props} ref={ref} className={classes("banger-select", className)} />;
});

export type StepButtonProps = ComponentPropsWithoutRef<"button"> & {
  active?: boolean;
  current?: boolean;
  accent?: string;
};

export const StepButton = forwardRef<HTMLButtonElement, StepButtonProps>(function StepButton(
  { active = false, current = false, accent, type = "button", className, style, ...props }, ref,
) {
  const stepStyle = accent ? { "--banger-step-accent": accent, ...style } as CSSProperties : style;
  return (
    <button
      aria-pressed={active}
      aria-current={current ? "step" : undefined}
      {...props}
      ref={ref}
      type={type}
      data-active={active ? "true" : undefined}
      data-current={current ? "true" : undefined}
      className={classes("banger-step", className)}
      style={stepStyle}
    />
  );
});

export type RangeProps = ComponentPropsWithoutRef<"input">;

export const Range = forwardRef<HTMLInputElement, RangeProps>(function Range(
  { type = "range", className, ...props }, ref,
) {
  return <input {...props} ref={ref} type={type} className={classes("banger-range", className)} />;
});

export type FieldProps = {
  label: string;
  htmlFor?: string;
  children: ReactNode;
};

export function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <label className="banger-field" htmlFor={htmlFor}>
      <span className="banger-field__label">{label}</span>
      {children}
    </label>
  );
}
