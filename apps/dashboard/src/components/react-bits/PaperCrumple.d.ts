import type { CSSProperties, JSX } from 'react';

/** Types for the React Bits PaperCrumple component (PaperCrumple.jsx). */
export type PaperCrumpleState = 'holding' | 'flat' | 'crumpled' | 'creased';

export interface PaperCrumpleProps {
  /** Image printed on the paper (data: URLs work; remote images need CORS). */
  src: string;
  alt?: string;
  backSrc?: string;
  width?: number;
  height?: number;
  sceneHeight?: number;
  imageFit?: 'cover' | 'contain';
  releaseBehavior?: 'stay' | 'restore' | 'creased';
  crumpleAmount?: number;
  crumpleDuration?: number;
  releaseDuration?: number;
  foldCount?: number;
  foldSharpness?: number;
  wrinkleDepth?: number;
  creaseStrength?: number;
  paperColor?: string;
  roughness?: number;
  paperTexture?: number;
  lightIntensity?: number;
  lightAngle?: number;
  shadow?: boolean;
  shadowOpacity?: number;
  draggable?: boolean;
  dragRotation?: number;
  dragRadius?: number;
  returnToOrigin?: boolean;
  rotation?: number;
  seed?: number;
  detail?: number;
  disabled?: boolean;
  resetKey?: number | string;
  onStateChange?: (state: PaperCrumpleState) => void;
  onError?: (error: Error) => void;
  className?: string;
  style?: CSSProperties;
}

declare function PaperCrumple(props: PaperCrumpleProps): JSX.Element;
export default PaperCrumple;
