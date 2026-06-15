---
name: Enterprise Sleek Design System (Precision Sentinel)
colors:
  # Surface (배경 레이어)
  surface: '#f7f9fb'
  surface-dim: '#cfdce3'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f0f4f7'
  surface-container: '#e8eff3'
  surface-container-high: '#e1e9ee'
  surface-container-highest: '#d9e4ea'
  surface-variant: '#d9e4ea'
  # On-Surface (텍스트)
  on-surface: '#2a3439'
  on-surface-variant: '#566166'
  # Primary (뮤트 슬레이트 — 보조 UI 요소)
  primary: '#565e74'
  on-primary: '#f7f7ff'
  primary-container: '#dae2fd'
  on-primary-container: '#4a5167'
  # Secondary (뮤트 블루-그레이)
  secondary: '#526075'
  on-secondary: '#f8f8ff'
  secondary-container: '#d5e3fd'
  on-secondary-container: '#455367'
  # Tertiary = 브랜드 액션 컬러 (Blue)
  tertiary: '#005bc4'
  on-tertiary: '#f9f8ff'
  tertiary-container: '#4388fd'
  on-tertiary-container: '#000311'
  # Error
  error: '#9f403d'
  on-error: '#fff7f6'
  error-container: '#fe8983'
  on-error-container: '#752121'
  # Outline
  outline: '#717c82'
  outline-variant: '#a9b4b9'
  # Inverse
  inverse-surface: '#0b0f10'
  inverse-on-surface: '#9a9d9f'
  inverse-primary: '#dae2fd'
  surface-tint: '#565e74'
  background: '#f4f7fa'
  on-background: '#2a3439'
typography:
  h1:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  h2:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  h3:
    fontFamily: Manrope
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
    letterSpacing: 0em
  page-title:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0em
  label-bold:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.12em
    textTransform: uppercase
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0em
  data-num:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: -0.02em
    fontVariantNumeric: tabular-nums
  mono:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0em
rounded:
  sm: 0.25rem
  DEFAULT: 0.375rem
  md: 0.5rem
  lg: 0.75rem
  xl: 1rem
  full: 9999px
spacing:
  unit: 8px
  gutter: 24px
  margin: 32px
  card-padding: 24px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
shadows:
  card: '0 1px 3px rgba(42,52,57,0.04), 0 1px 2px rgba(42,52,57,0.03)'
  ambient: '0 12px 32px rgba(42,52,57,0.06)'
  ambient-md: '0 8px 24px rgba(42,52,57,0.08)'
  ambient-sm: '0 4px 12px rgba(42,52,57,0.05)'
  navbar: '0 1px 0 rgba(169,180,185,0.15), 0 4px 16px rgba(42,52,57,0.06)'
  modal: '0 10px 30px rgba(42,52,57,0.12)'
---

## Brand & Style

This design system is engineered for high-stakes enterprise environments where clarity, speed of cognition, and professional "weight" are paramount. The aesthetic is **Enterprise Sleek (Precision Sentinel)**—a refined blend of minimalism and modern corporate standards. It evokes a sense of "expensive" precision through generous whitespace, high-contrast typography, and a restrained but punchy accent palette.

The target audience consists of data analysts, system administrators, and executive stakeholders who require a tool that feels both utilitarian and premium. The UI avoids unnecessary ornamentation, relying instead on structural integrity and subtle depth to guide the user's focus toward critical data points and actionable insights.

## Colors

The palette uses a **muted blue-gray slate** for structural elements (`primary`, `secondary`), with **Brand Blue** (`tertiary: #005bc4`) reserved exclusively for interactive actions, active links, and progress indicators. Surface tiers create logical depth without heavy borders.

Green is **not part of the core palette tokens** — success/positive states use Tailwind's `emerald-500/600` directly. Error states use a dark, desaturated red (`#9f403d`) with matching containers.

All colors must maintain a 4.5:1 contrast ratio against their respective backgrounds.

**Background**: Base canvas is `#f4f7fa` with a subtle radial gradient — `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,91,196,0.08) 0%, transparent 70%)` — casting a faint blue glow from the top center.

### Border pattern
Card borders use `border border-ds-outline-variant/8` (8% opacity) by default. For stronger separation use `/10` or `/15`.

## Typography

The system uses **four font families**:

| Role | Font | Usage |
|---|---|---|
| Headlines / Page titles | **Manrope** | h1–h4, page titles |
| Body / Data / UI labels | **Inter** | All other text |
| Korean fallback | **Pretendard** | Automatically applied when Korean characters are present |
| Numbers / Code / IPs | **JetBrains Mono** | IPs, timestamps, code, technical identifiers |

Visual hierarchy is established through extreme weight variance. Table headers use `text-[10px] font-bold uppercase tracking-widest` (all-caps, wide letter-spacing) to distinguish them from interactive body content. KPI numbers use `text-2xl font-bold tabular-nums`.

## Layout & Spacing

The system follows an **8px base unit**. A typical page structure:

```tsx
<div className="flex flex-col gap-6">
  {/* Page header: title + action buttons */}
  <div className="flex items-center justify-between shrink-0">
    <h1 className="text-xl font-semibold tracking-tight text-ds-on-surface font-headline">...</h1>
  </div>
  {/* KPI cards */}
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">...</div>
  {/* Main content card */}
  <div className="bg-white rounded-xl border border-ds-outline-variant/8 shadow-sm flex flex-col overflow-hidden">
    ...
  </div>
</div>
```

**Navbar**: `h-13` (3.25rem), `bg-white/80 backdrop-blur-xl shadow-navbar` — glassmorphism. Logo: `text-[15px] font-extrabold text-ds-tertiary font-headline`.

## Elevation & Depth

Depth is communicated through **Tonal Layers** and **Ambient Shadows**:

1. **Level 0 (Background)**: `#f4f7fa` with radial blue gradient — base canvas.
2. **Level 1 (Cards/Surface)**: `bg-white rounded-xl border border-ds-outline-variant/8 shadow-sm` — subtle 1px tinted border, no heavy shadow.
3. **Level 2 (Dropdowns/Modals)**: `bg-white/90 backdrop-blur-xl shadow-ambient-md` — lifted with pronounced shadow.

Avoid heavy borders; use 1px strokes at low opacity only when distinct separation is required at the same elevation.

## Shapes

Border radius uses `0.375rem` (6px) as default for inputs, badges, and small components. Cards and containers use `rounded-xl` (0.75rem / 12px). Pill/chip shapes use `rounded-full`.

## Components

### Buttons

**Primary action** (add, save): `btn-primary-gradient` (`linear-gradient(135deg, #005bc4, #004fad)`) + white text + `rounded-lg shadow-sm`.

**Secondary action** (refresh, export): `bg-white border border-ds-outline-variant/10 text-ds-on-surface-variant rounded-lg shadow-sm hover:bg-ds-surface-container-low`.

**Sub action** (batch, template): `bg-ds-surface-container-low border border-ds-outline-variant/10 text-ds-on-surface-variant rounded-lg`.

**Icon-only**: `p-1.5 hover:bg-ds-surface-container-high rounded-lg`. Delete variant: `hover:bg-red-50 hover:text-ds-error`.

### Cards & Modules

```tsx
<div className="bg-white rounded-xl border border-ds-outline-variant/8 shadow-sm">
  {/* Header */}
  <div className="flex items-center justify-between px-5 py-3 border-b border-ds-outline-variant/8">
    <span className="text-[13px] font-semibold text-ds-on-surface">Title</span>
  </div>
  {/* Content: 24px padding */}
</div>
```

KPI cards: number-only, no icons. Use `text-2xl font-bold tabular-nums` for the figure. Progress bar (optional): `h-1 bg-ds-surface-container-high rounded-full` track, `bg-emerald-500` or `bg-ds-tertiary` fill.

### Data Tables

**AG Grid**: Custom `ag-theme-quartz` override applied via `index.css`. Row height 44px, header 26px, `font-size: 12px`. No vertical borders. Header text: `10px bold uppercase tracking-wide` at 60% opacity.

**HTML tables**: `divide-y divide-ds-outline-variant/8`, header `bg-ds-surface-container-low/30`, row hover `hover:bg-ds-surface-container-low/30`.

### Status Chips

Dot + text pattern (not pill):

```tsx
<span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
  완료
</span>
```

States: `success → emerald`, `in_progress → ds-tertiary + animate-pulse`, `pending → ds-outline`, `failure/error → ds-error`.

### Badges / Tags

Vendor badges: `bg-orange-50 text-orange-600 border border-orange-100` pattern — `inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide`.

Group tags: `bg-ds-tertiary/10 text-ds-tertiary`.

### Progress Bars

Height: `h-1` (4px). Fully rounded. Fill: `bg-emerald-500` (success) or `bg-ds-tertiary` (progress). Track: `bg-ds-surface-container-high`.

### Search Input

```tsx
<div className="flex items-center gap-1.5 bg-ds-surface-container-low rounded-lg px-2.5 py-1.5 border border-ds-outline-variant/10">
  <Search className="w-3 h-3 text-ds-on-surface-variant" />
  <input className="text-[12px] bg-transparent outline-none placeholder:text-ds-on-surface-variant/40" />
</div>
```

### Alert Banners

`bg-ds-error/4 border border-ds-error/15 rounded-xl` — icon `w-4 h-4 text-ds-error`, title `text-[13px] font-semibold text-ds-error`, description `text-[11px] text-ds-error/60`.
