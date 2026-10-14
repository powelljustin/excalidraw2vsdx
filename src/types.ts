/** Subset of the Excalidraw element JSON this converter understands. */

export interface ExcalidrawBinding {
  elementId: string;
  focus?: number;
  gap?: number;
  /** Normalized point on the target, x from the left and y from the top (0–1). */
  fixedPoint?: [number, number] | null;
}

export interface ExcalidrawRoundness {
  type?: number;
  value?: number;
}

export interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
  groupIds?: string[];
  frameId?: string | null;
  roundness?: ExcalidrawRoundness | null;
  isDeleted?: boolean;
  boundElements?: Array<{ id: string; type: string }> | null;
  link?: string | null;
  locked?: boolean;
  text?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: "left" | "center" | "right" | string;
  verticalAlign?: "top" | "middle" | "bottom" | string;
  containerId?: string | null;
  lineHeight?: number;
  points?: Array<[number, number]>;
  startBinding?: ExcalidrawBinding | null;
  endBinding?: ExcalidrawBinding | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  elbowed?: boolean;
  polygon?: boolean;
  fileId?: string | null;
  status?: string;
  name?: string;
  scale?: [number, number];
}

export interface ExcalidrawFileData {
  id?: string;
  mimeType?: string;
  dataURL?: string;
}

export interface ExcalidrawScene {
  name: string;
  elements: ExcalidrawElement[];
  files: Record<string, ExcalidrawFileData>;
}

export interface LibraryItem {
  id?: string;
  name?: string;
  status?: string;
  elements?: ExcalidrawElement[];
  files?: Record<string, ExcalidrawFileData>;
}
