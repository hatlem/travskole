import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Bjerke Ponniskole';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #003B7A 0%, #002855 100%)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '24px',
          }}
        >
          <div
            style={{
              fontSize: '72px',
              fontWeight: 800,
              color: 'white',
              letterSpacing: '-2px',
              textAlign: 'center',
            }}
          >
            Bjerke Ponniskole
          </div>
          <div
            style={{
              fontSize: '28px',
              color: 'rgba(255,255,255,0.8)',
              textAlign: 'center',
              maxWidth: '700px',
            }}
          >
            Kurs og leirer for barn og unge med ponni og hest
          </div>
          <div
            style={{
              marginTop: '16px',
              display: 'flex',
              gap: '16px',
            }}
          >
            <div
              style={{
                background: 'rgba(255,255,255,0.15)',
                borderRadius: '999px',
                padding: '10px 24px',
                fontSize: '18px',
                color: 'white',
              }}
            >
              Kurs
            </div>
            <div
              style={{
                background: 'rgba(255,255,255,0.15)',
                borderRadius: '999px',
                padding: '10px 24px',
                fontSize: '18px',
                color: 'white',
              }}
            >
              Sommerleirer
            </div>
            <div
              style={{
                background: 'rgba(255,255,255,0.15)',
                borderRadius: '999px',
                padding: '10px 24px',
                fontSize: '18px',
                color: 'white',
              }}
            >
              Dobbeltsulky
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
