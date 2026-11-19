import type { CSSProperties, JSX, ReactNode } from 'react';

/** Types for the React Bits CursorGrid component (CursorGrid.jsx). */
export interface CursorGridProps {
  /** Colour of lit cells and pulses (hex). */
  color?: string;
  /** Colour of the grid lines (hex). */
  gridColor?: string;
  cellSize?: number;
  highlight?: 'area' | 'cell';
  gridStyle?: 'lines' | 'dashed' | 'dots' | 'crosses';
  /** Reach of the cursor in px. */
  radius?: number;
  falloff?: 'smooth' | 'linear' | 'sharp';
  holdTime?: number;
  fadeDuration?: number;
  lineWidth?: number;
  maxOpacity?: number;
  fillOpacity?: number;
  gridOpacity?: number;
  /** 0–1 */
  spotlight?: number;
  cellGap?: number;
  cellRadius?: number;
  clickPulse?: boolean;
  pulseSpeed?: number;
  /** Random cells glow on their own, 0–1. */
  ambient?: number;
  /** 0–0.5 */
  edgeFade?: number;
  intro?: boolean;
  lightMode?: boolean;
  /** Kiln addition: false ignores the pointer (no hover light, no click rings). Default true. */
  interactive?: boolean;
  /** Kiln addition: send a ring from a random point roughly every N ms. 0 = off. */
  autoPulse?: number;
  children?: ReactNode;
  dpr?: number;
  className?: string;
  style?: CSSProperties;
}

declare function CursorGrid(props: CursorGridProps): JSX.Element;
export default CursorGrid;
