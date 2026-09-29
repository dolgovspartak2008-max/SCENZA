import type { ComponentPropsWithRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import './shiny-button.css';

const buttonVariants = cva('scenza-button inline-flex items-center justify-center gap-2 rounded-full font-semibold disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4', {
  variants: {
    variant: { default: 'scenza-button-primary', outline: 'scenza-button-outline', ghost: 'scenza-button-ghost' },
    size: { default: 'min-h-11 px-5 py-3 text-sm', sm: 'min-h-10 px-4 py-2 text-sm', lg: 'min-h-12 px-6 py-3 text-base', icon: 'size-11 p-2' },
  }, defaultVariants: { variant: 'default', size: 'default' },
});
export type ButtonProps = ComponentPropsWithRef<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };
export function Button({ className, variant, size, asChild, type = 'button', ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), size !== 'icon' && 'shiny-cta', className)} {...(!asChild ? { type } : {})} {...props} />;
}
