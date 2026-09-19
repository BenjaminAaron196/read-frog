import type { ReactNode } from "react"
import { cn } from "@/utils/styles/utils"

export interface ConfigSectionProps {
  id?: string
  title: ReactNode
  /** Set when the surrounding surface already names the section (a tab, a panel). */
  hideTitle?: boolean
  children: ReactNode
  className?: string
  contentClassName?: string
  titleClassName?: string
}

export function ConfigSection({
  id,
  title,
  hideTitle,
  children,
  className,
  contentClassName,
  titleClassName,
}: ConfigSectionProps) {
  return (
    <section id={id} className={cn("w-full", className)}>
      <h2
        className={cn(
          "mb-4 border-b pb-3 text-base font-medium text-foreground",
          hideTitle && "hidden",
          titleClassName,
        )}
      >
        {title}
      </h2>
      <div className={cn("flex w-full flex-col gap-6", contentClassName)}>{children}</div>
    </section>
  )
}
