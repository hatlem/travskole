import { ImageResponse } from 'next/og';
import { getSettings, settingToList } from '@/lib/settings';
import { BRAND } from '@/lib/brand';

export const runtime = 'nodejs';
export const alt = 'Bjerke — kurs og arrangementer';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  const settings = await getSettings();
  const tags = settingToList(settings.og_tags);

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
          background: `linear-gradient(135deg, ${BRAND.blue} 0%, ${BRAND.blueDark} 100%)`,
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
            {settings.site_name}
          </div>
          <div
            style={{
              fontSize: '28px',
              color: 'rgba(255,255,255,0.8)',
              textAlign: 'center',
              maxWidth: '700px',
            }}
          >
            {settings.site_short_description}
          </div>
          {tags.length > 0 && (
            <div
              style={{
                marginTop: '16px',
                display: 'flex',
                gap: '16px',
              }}
            >
              {tags.map((tag) => (
                <div
                  key={tag}
                  style={{
                    background: 'rgba(255,255,255,0.15)',
                    borderRadius: '999px',
                    padding: '10px 24px',
                    fontSize: '18px',
                    color: 'white',
                  }}
                >
                  {tag}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    ),
    { ...size }
  );
}
