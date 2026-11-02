import type {Metadata} from 'next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'TradeLab - Forex Strategy Analysis & Backtesting',
  description: 'Professional personal Forex strategy analysis and backtesting terminal with TradingView lightweight charts, real-time indicator overlays, strategy tuning, and R-multiple metrics.',
  openGraph: {
    title: 'TradeLab - Forex Strategy Analysis & Backtesting',
    description: 'Professional personal Forex strategy analysis and backtesting terminal with TradingView lightweight charts, real-time indicator overlays, strategy tuning, and R-multiple metrics.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TradeLab - Forex Strategy Analysis & Backtesting',
    description: 'Professional personal Forex strategy analysis and backtesting terminal with TradingView lightweight charts, real-time indicator overlays, strategy tuning, and R-multiple metrics.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // Ensure window.fetch is writable and has a setter for extension compatibility
                  var currentFetch = window.fetch;
                  try {
                    Object.defineProperty(window, 'fetch', {
                      get: function() { return currentFetch; },
                      set: function(val) { currentFetch = val; },
                      configurable: true,
                      enumerable: true
                    });
                  } catch (e1) {
                    try {
                      Object.defineProperty(Window.prototype, 'fetch', {
                        get: function() { return currentFetch; },
                        set: function(val) { currentFetch = val; },
                        configurable: true,
                        enumerable: true
                      });
                    } catch (e2) {}
                  }

                  // Intercept and swallow rogue chrome-extension errors
                  window.addEventListener('error', function(event) {
                    if (
                      (event.filename && event.filename.indexOf('chrome-extension://') !== -1) ||
                      (event.message && event.message.indexOf('Cannot set property fetch') !== -1)
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      return true;
                    }
                  }, true);
                } catch (err) {}
              })();
            `,
          }}
        />
      </head>
      <body className="bg-[#0b0e14] text-slate-100 antialiased selection:bg-emerald-500/20 selection:text-emerald-300 min-h-screen overflow-x-hidden font-sans" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
