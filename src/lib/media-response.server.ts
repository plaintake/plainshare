const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * Serves an R2 object with single-range support. Content-addressed keys mean
 * the bytes at a key can never change, which is what makes the immutable
 * cache header safe.
 */
export async function mediaResponse(
  bucket: R2Bucket,
  key: string,
  request: Request,
  contentType: string,
): Promise<Response> {
  const head = await bucket.head(key)
  if (head === null) {
    return Response.json({ error: 'not-found' }, { status: 404 })
  }

  const rangeHeader = request.headers.get('range')
  if (rangeHeader !== null) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    let offset: number | undefined
    let length: number | undefined
    let suffix: number | undefined
    if (match !== null) {
      const startRaw = match[1] ?? ''
      const endRaw = match[2] ?? ''
      if (startRaw === '' && endRaw !== '') {
        suffix = Math.min(Number.parseInt(endRaw, 10), head.size)
      } else if (startRaw !== '') {
        const start = Number.parseInt(startRaw, 10)
        const end = endRaw === '' ? head.size - 1 : Math.min(Number.parseInt(endRaw, 10), head.size - 1)
        if (start >= head.size || end < start) {
          return new Response(null, {
            status: 416,
            headers: { 'content-range': `bytes */${head.size}` },
          })
        }
        offset = start
        length = end - start + 1
      }
    }
    if (match === null) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${head.size}` },
      })
    }

    const range: R2Range =
      suffix !== undefined && offset === undefined ? { suffix } : { offset: offset!, length: length! }
    const object = await bucket.get(key, { range })
    if (object === null) {
      return Response.json({ error: 'not-found' }, { status: 404 })
    }
    // Range extents come from the request, never from object.size — the R2
    // body's reported size is not guaranteed to be the partial length.
    const first = offset ?? head.size - suffix!
    const last = offset !== undefined ? offset + length! - 1 : head.size - 1
    const bodyLength = last - first + 1
    return new Response(object.body, {
      status: 206,
      headers: {
        'content-type': contentType,
        'content-length': String(bodyLength),
        'content-range': `bytes ${first}-${last}/${head.size}`,
        'accept-ranges': 'bytes',
        'cache-control': IMMUTABLE,
        etag: head.etag,
      },
    })
  }

  const object = await bucket.get(key)
  if (object === null) {
    return Response.json({ error: 'not-found' }, { status: 404 })
  }
  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(object.size),
      'accept-ranges': 'bytes',
      'cache-control': IMMUTABLE,
      etag: object.etag,
    },
  })
}
