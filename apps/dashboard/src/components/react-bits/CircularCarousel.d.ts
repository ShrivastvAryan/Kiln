import type { CSSProperties, JSX } from 'react';

/** Types for the React Bits CircularCarousel component (CircularCarousel.jsx). */
export interface CircularCarouselItem {
  src: string;
  alt?: string;
  title?: string;
  subtitle?: string;
}

export interface CircularCarouselProps {
  items?: CircularCarouselItem[];
  preset?: 'cylinder' | 'orbit' | 'wheel' | 'panorama';
  intro?: 'assemble' | 'rise' | 'spin' | 'none';
  /** Card width in px. */
  cardWidth?: number;
  /** Card width ÷ height. */
  aspectRatio?: number;
  gap?: number;
  curve?: number;
  tilt?: number;
  perspective?: number;
  autoplay?: 'drift' | 'step' | 'off';
  /** Drift speed, degrees per second. */
  speed?: number;
  /** Seconds between moves in step mode. */
  interval?: number;
  direction?: 'left' | 'right';
  draggable?: boolean;
  momentum?: number;
  snap?: boolean;
  pauseOnHover?: boolean;
  focusOnClick?: boolean;
  parallax?: number;
  stretch?: number;
  depthFade?: number;
  /** Colour distant cards fade toward; match the background. */
  fadeColor?: string;
  innerShade?: number;
  cornerRadius?: number;
  captions?: boolean;
  onChange?: (index: number) => void;
  onItemClick?: (item: CircularCarouselItem, index: number) => void;
  className?: string;
  style?: CSSProperties;
}

declare function CircularCarousel(props: CircularCarouselProps): JSX.Element;
export default CircularCarousel;
