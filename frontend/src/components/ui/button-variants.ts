import { cva } from "class-variance-authority"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        // Precision Sentinel 전용 — 기존 .btn-primary-gradient 인라인 스타일을 컴포넌트화
        gradient: "btn-primary-gradient text-white shadow-sm hover:opacity-90 [&_svg]:size-auto",
        // Precision Sentinel 전용 — 카드형 아웃라인 버튼(갱신 등)을 컴포넌트화
        subtle:
          "bg-white text-ds-on-surface-variant border border-ds-outline-variant/10 shadow-sm hover:text-ds-on-surface hover:bg-ds-surface-container-low [&_svg]:size-auto",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        // Precision Sentinel 전용 — 고정 height 없이 className의 padding으로만 크기를 결정
        auto: "h-auto",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)
