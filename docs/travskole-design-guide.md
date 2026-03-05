# Travskole Design Guide (Based on Bjerke.no)

## 🎨 Color Palette

### Primary Colors
```css
--bjerke-blue: #003B7A;        /* Deep royal blue (header, buttons) */
--bjerke-blue-dark: #002855;   /* Darker blue for hover states */
--bjerke-blue-light: #0052A3;  /* Lighter blue for accents */
```

### Neutral Colors
```css
--white: #FFFFFF;              /* Card backgrounds, text on blue */
--gray-50: #F9FAFB;            /* Light background */
--gray-100: #F3F4F6;           /* Subtle backgrounds */
--gray-200: #E5E7EB;           /* Card borders */
--gray-600: #4B5563;           /* Secondary text */
--gray-900: #111827;           /* Primary text */
```

### Semantic Colors
```css
--success: #10B981;            /* Confirmed status */
--warning: #F59E0B;            /* Pending status */
--error: #EF4444;              /* Error states */
```

---

## 📐 Layout Structure

### Header
- **Background**: Deep blue (`#003B7A`)
- **Logo**: White Bjerke logo (left side)
- **Navigation**: Hamburger menu (right side, mobile-first)
- **Height**: ~70px
- **Sticky**: Yes (stays at top on scroll)

### Hero Section
- **Image**: Full-width background image with dark overlay
- **Overlay**: `rgba(0, 0, 0, 0.4)` for text readability
- **Text**: Large, bold white text
- **CTA Button**: Blue background with white text
- **Height**: 50-60vh (viewport height)

### Event/Course Cards
```
┌─────────────────────────────────┐
│ Title (Bold, Large)             │ Icon
├─────────────────────────────────┤
│ Date (8. mars 2026)             │
├─────────────────────────────────┤
│ Dørene åpner | Første løp | Pris│
│ 17:15        | 18:15      | Gratis│
└─────────────────────────────────┘
```

**Card Styling:**
- White background
- Subtle shadow: `box-shadow: 0 1px 3px rgba(0,0,0,0.1)`
- Border: `1px solid #E5E7EB`
- Border-radius: `8px`
- Padding: `24px`
- Margin: `16px 0`

---

## 🔤 Typography

### Font Family
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
```

### Font Sizes
```css
--text-xs: 0.75rem;    /* 12px - labels */
--text-sm: 0.875rem;   /* 14px - secondary text */
--text-base: 1rem;     /* 16px - body text */
--text-lg: 1.125rem;   /* 18px - large body */
--text-xl: 1.25rem;    /* 20px - small headings */
--text-2xl: 1.5rem;    /* 24px - card titles */
--text-3xl: 1.875rem;  /* 30px - section headings */
--text-4xl: 2.25rem;   /* 36px - page headings */
--text-5xl: 3rem;      /* 48px - hero text */
```

### Font Weights
- **Regular**: 400 (body text)
- **Medium**: 500 (labels, buttons)
- **Semibold**: 600 (card titles)
- **Bold**: 700 (headings)

---

## 🎯 Component Styles

### Buttons

**Primary Button (CTA)**
```css
background: #003B7A;
color: white;
padding: 12px 24px;
border-radius: 6px;
font-weight: 600;
font-size: 1rem;
transition: background 0.2s;

&:hover {
  background: #002855;
}
```

**Secondary Button**
```css
background: white;
color: #003B7A;
border: 2px solid #003B7A;
padding: 12px 24px;
border-radius: 6px;
font-weight: 600;

&:hover {
  background: #F9FAFB;
}
```

### Links
```css
color: #003B7A;
text-decoration: none;
font-weight: 500;

&:hover {
  text-decoration: underline;
}
```

### Icons
- **Style**: Outline/line icons (not filled)
- **Size**: 20-24px for inline, 32px for larger contexts
- **Color**: Match text color or blue accent

---

## 📱 Responsive Design

### Breakpoints
```css
sm: 640px   /* Small tablets */
md: 768px   /* Tablets */
lg: 1024px  /* Laptops */
xl: 1280px  /* Desktops */
```

### Mobile-First Approach
- Stack cards vertically on mobile
- Single column layout
- Hamburger menu for navigation
- Touch-friendly button sizes (min 44px height)

---

## 🖼️ Images

### Hero Image
- High quality (min 1920x1080)
- Dark overlay for text contrast
- Use: `hero-sulky-track.jpg` or `group-sunset.jpg`

### Card Images (Optional)
- Aspect ratio: 16:9 or 4:3
- Border-radius: 8px
- Object-fit: cover

---

## 📋 Form Styling

### Input Fields
```css
border: 1px solid #E5E7EB;
border-radius: 6px;
padding: 10px 14px;
font-size: 1rem;
background: white;

&:focus {
  outline: none;
  border-color: #003B7A;
  box-shadow: 0 0 0 3px rgba(0, 59, 122, 0.1);
}
```

### Checkboxes
```css
width: 20px;
height: 20px;
border: 2px solid #D1D5DB;
border-radius: 4px;

&:checked {
  background: #003B7A;
  border-color: #003B7A;
}
```

### Labels
```css
font-weight: 500;
font-size: 0.875rem;
color: #374151;
margin-bottom: 6px;
```

---

## 🎭 Visual Hierarchy

### Priority Levels
1. **Hero**: Largest, most prominent
2. **Section Headings**: Large, bold
3. **Card Titles**: Medium-large, semibold
4. **Body Text**: Regular weight, good line-height
5. **Meta Info**: Smaller, lighter color

### Spacing
- Use multiples of 4px for consistency
- Card padding: 24px
- Section margins: 48px-64px
- Element spacing: 16px

---

## 🌟 Design Principles

1. **Clean & Minimal**: Lots of whitespace, no clutter
2. **Professional**: Business-like but friendly
3. **Accessible**: High contrast, readable fonts
4. **Mobile-First**: Works perfectly on phones
5. **Fast**: Optimized images, minimal animations

---

## 💡 Example Implementation (Tailwind)

### Event Card Component
```jsx
<div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
  <div className="flex justify-between items-start mb-3">
    <h3 className="text-2xl font-semibold text-gray-900">
      Søndagskveld med Internasjonal V65
    </h3>
    <span className="text-bjerke-blue">→</span>
  </div>
  
  <p className="text-gray-600 mb-4">8. mars 2026</p>
  
  <div className="grid grid-cols-3 gap-4">
    <div>
      <p className="text-sm text-gray-500">Dørene åpner</p>
      <p className="font-semibold">17:15</p>
    </div>
    <div>
      <p className="text-sm text-gray-500">Første løp</p>
      <p className="font-semibold">18:15</p>
    </div>
    <div>
      <p className="text-sm text-gray-500">Pris</p>
      <p className="font-semibold">Gratis</p>
    </div>
  </div>
</div>
```

### Hero Section
```jsx
<div className="relative h-[60vh] bg-cover bg-center" 
     style={{backgroundImage: 'url(/images/hero-sulky-track.jpg)'}}>
  <div className="absolute inset-0 bg-black bg-opacity-40"></div>
  <div className="relative z-10 flex flex-col items-center justify-center h-full text-white px-4">
    <h1 className="text-5xl font-bold mb-4 text-center">
      Velkommen til Bjerke Travskole
    </h1>
    <p className="text-xl mb-8 text-center max-w-2xl">
      Opplev gleden ved travsporten i trygge omgivelser
    </p>
    <button className="bg-bjerke-blue hover:bg-bjerke-blue-dark px-8 py-3 rounded-lg font-semibold text-lg transition">
      Meld på kurs
    </button>
  </div>
</div>
```

---

## 🔧 Tailwind Config

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        'bjerke-blue': {
          DEFAULT: '#003B7A',
          dark: '#002855',
          light: '#0052A3',
        },
      },
    },
  },
}
```

---

_Design reference: Bjerke.no (March 2026)_
