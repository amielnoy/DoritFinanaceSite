import * as React from "react";

export interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** How a Wix-media source is fitted into its box. Other URLs render as a plain <img>. */
  fittingType?: "fill" | "fit" | string;
  originWidth?: number;
  originHeight?: number;
  focalPointX?: number;
  focalPointY?: number;
  /** WebP quality for optimised sources, 0–100. */
  quality?: number;
}

export const Image: React.ForwardRefExoticComponent<ImageProps & React.RefAttributes<HTMLImageElement>>;
