import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: [
          'var(--font-inter)',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      colors: {
        // Martinrea brand
        brand: {
          DEFAULT: '#003364',
          50: '#E8EEF5',
          100: '#C6D6E5',
          200: '#93AECB',
          300: '#5C82AC',
          400: '#2E5C8A',
          500: '#003364',
          600: '#002A52',
          700: '#00203F',
          800: '#001830',
          900: '#001020',
        },
        sidebar: {
          DEFAULT: '#0F1923',
          hover: '#1A2632',
          active: '#2E5C8A',
          muted: '#8A95A6',
          border: '#1F2A36',
        },
        canvas: '#F4F6FA',
        ink: {
          DEFAULT: '#0B1320',
          muted: '#5A6776',
          subtle: '#8B95A4',
        },
        line: '#E5E9F0',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Status palette for invoice states
        status: {
          received: '#64748B',
          ocr: '#0EA5E9',
          review: '#F59E0B',
          match: '#8B5CF6',
          matched: '#06B6D4',
          approval: '#EAB308',
          approved: '#10B981',
          rejected: '#EF4444',
          exception: '#F43F5E',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 25, 35, 0.04), 0 1px 3px rgba(15, 25, 35, 0.06)',
        elevated:
          '0 4px 12px rgba(15, 25, 35, 0.06), 0 2px 4px rgba(15, 25, 35, 0.04)',
        focus: '0 0 0 3px rgba(0, 51, 100, 0.18)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200px 0' },
          '100%': { backgroundPosition: 'calc(200px + 100%) 0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
