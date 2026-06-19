import { ImageResponse } from 'next/og';
import { BRAND } from '@/lib/brand';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 90,
          background: BRAND.blue,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          borderRadius: '20%',
          fontWeight: 700,
          fontFamily: 'system-ui',
        }}
      >
        BT
      </div>
    ),
    { ...size }
  );
}
