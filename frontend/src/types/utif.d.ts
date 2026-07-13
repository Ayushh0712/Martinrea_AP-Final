// Ambient module declaration for `utif` (pure-JS TIFF decoder). Only the
// subset we call is typed; the actual library exposes more.
declare module 'utif' {
  export interface IFD {
    width: number;
    height: number;
    // UTIF stores decoded pixel data on the IFD after `decodeImage`.
    data?: Uint8Array;
    // Raw TIFF tags keyed by numeric id (kept loose on purpose).
    [tag: string]: unknown;
  }

  /** Parse a TIFF file into an array of image directories (one per page). */
  export function decode(buffer: ArrayBuffer | Uint8Array): IFD[];

  /** Decode one image directory into `ifd.data` (populated in place). */
  export function decodeImage(
    buffer: ArrayBuffer | Uint8Array,
    ifd: IFD,
    ifds?: IFD[],
  ): void;

  /** Convert a decoded IFD to RGBA (Uint8Array, 4 bytes per pixel). */
  export function toRGBA8(ifd: IFD): Uint8Array;

  const _default: {
    decode: typeof decode;
    decodeImage: typeof decodeImage;
    toRGBA8: typeof toRGBA8;
  };
  export default _default;
}
