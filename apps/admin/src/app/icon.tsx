import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#06b6d4',
        borderRadius: 6,
        fontSize: 20,
        fontWeight: 700,
        color: 'white',
        fontFamily: 'sans-serif',
      }}
    >
      W
    </div>,
    { ...size },
  )
}
