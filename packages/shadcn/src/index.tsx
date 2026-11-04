"use client";

import { forwardRef, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";

import { Button as ShadcnButton } from "./components/button.js";
import { Input as ShadcnInput } from "./components/input.js";
import { NativeSelect } from "./components/native-select.js";
import { Textarea as ShadcnTextarea } from "./components/textarea.js";
import { Card } from "./components/card.js";
import { Label } from "./components/label.js";

export { Checkbox } from "./components/checkbox.js";
export { Slider } from "./components/slider.js";
export { Modal, type ModalHandle } from "./modal.js";

function classes(...values: (string | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", type = "button", className, ...props }, ref,
) {
  return <ShadcnButton {...props} ref={ref} type={type} variant={variant === "primary" ? "default" : variant === "danger" ? "destructive" : variant} className={classes("banger-button", `banger-button--${variant}`, className)} />;
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
  return <Card asChild className={classes("banger-panel", className)}><section {...props} ref={ref} /></Card>;
});

export type InputProps = ComponentPropsWithoutRef<"input">;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props }, ref,
) {
  return <ShadcnInput {...props} ref={ref} className={classes("banger-input", className)} />;
});

export type SelectProps = Omit<ComponentPropsWithoutRef<"select">, "size">;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props }, ref,
) {
  return <NativeSelect nativeAppearance {...props} ref={ref} className={classes("banger-select", className)} />;
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
    <Label className="banger-field" htmlFor={htmlFor}>
      <span className="banger-field__label">{label}</span>
      {children}
    </Label>
  );
}

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(function Textarea({ className, ...props }, ref) {
  return <ShadcnTextarea {...props} ref={ref} className={classes("banger-textarea", className)} />;
});
