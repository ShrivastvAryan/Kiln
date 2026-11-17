import type { ForwardRefExoticComponent, HTMLAttributes, ReactNode, RefAttributes } from 'react';

/** Types for the React Bits CardSwap component (CardSwap.jsx). */
export interface CardSwapItem {
  title?: string;
  image?: string;
  icon?: ReactNode;
  alt?: string;
}

export interface CardSwapHandle {
  next: () => void;
  prev: () => void;
}

export interface CardSwapProps {
  items?: CardSwapItem[];
  children?: ReactNode;
  /** Card width in px. */
  width?: number;
  /** Card height in px. */
  height?: number;
  cardDistance?: number;
  verticalDistance?: number;
  depth?: number;
  skewAmount?: number;
  visibleCards?: number;
  /** ms between swaps. */
  delay?: number;
  autoplay?: boolean;
  pauseOnHover?: boolean;
  draggable?: boolean;
  speed?: number;
  bounce?: number;
  parallax?: number;
  hoverSpread?: number;
  dim?: number;
  cardRadius?: number;
  intro?: boolean;
  theme?: 'dark' | 'light';
  onCardClick?: (index: number) => void;
  /** Index of the new front card after each swap. */
  onChange?: (index: number) => void;
  className?: string;
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  customClass?: string;
}

export const Card: ForwardRefExoticComponent<CardProps & RefAttributes<HTMLDivElement>>;

declare const CardSwap: ForwardRefExoticComponent<CardSwapProps & RefAttributes<CardSwapHandle>>;
export default CardSwap;
