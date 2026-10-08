/** Resolve only once the image can be uploaded/drawn without synchronous decode. */
export async function loadImage(src, { fallbackSrc, fetchPriority = 'auto' } = {}) {
  const load = url => new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.fetchPriority = fetchPriority;
    image.onload = async () => {
      try {
        await image.decode();
        resolve(image);
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error(`Unable to load image: ${url}`));
    image.src = url;
  });
  try { return await load(src); }
  catch (error) {
    if (!fallbackSrc || fallbackSrc === src) throw error;
    return load(fallbackSrc);
  }
}
