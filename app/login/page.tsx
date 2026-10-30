
'use client';

import { FormEvent, useState } from 'react';
import {
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Mail,
  LockKeyhole,
  Eye,
  EyeOff,
  ChartNoAxesColumnIncreasing,
  Settings,
} from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Authentication and backend logic preserved.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        setMessage(result.error || 'Unable to sign in.');
        return;
      }

      setMessage('Signed in. Opening SVMA Intelligent Operations…');
      window.location.replace('/');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to sign in.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
   <main className="svma-login">
  <section className="svma-login-story">
    <div className="story-overlay" />

    <div className="story-content">
      <a
        className="story-brand animate-left delay-0"
        href="#"
        aria-label="SVMA Intelligence"
      >
        <span className="brand-accent" />
        <Sparkles size={19} />
        <span>SVMA INTELLIGENCE</span>
      </a>

      <div className="story-main">
        <span className="story-eyebrow animate-left delay-1">
          INTELLIGENT INDUSTRIAL OPERATIONS
        </span>

        <h1 className="animate-left delay-2">
          Operational
          <br />
          clarity.
          <br />
          <span>One shift</span>
          <br />
          <span>at a time.</span>
        </h1>

        <p className="story-description animate-left delay-3">
          Your team’s production, safety, quality and finance —
          connected in one place.
        </p>

        <div className="story-features">
          <div className="story-feature animate-left delay-4">
            <span className="feature-icon feature-blue">
              <ChartNoAxesColumnIncreasing size={25} />
            </span>
            <div>
              <strong>Real-time insights</strong>
              <span>Monitor operations across all units</span>
            </div>
          </div>

          <div className="story-feature animate-left delay-5">
            <span className="feature-icon feature-green">
              <Settings size={24} />
            </span>
            <div>
              <strong>Higher efficiency</strong>
              <span>Make smarter operational decisions</span>
            </div>
          </div>

          <div className="story-feature animate-left delay-6">
            <span className="feature-icon feature-light">
              <ShieldCheck size={25} />
            </span>
            <div>
              <strong>Safer operations</strong>
              <span>Proactive alerts and compliance</span>
            </div>
          </div>
        </div>
      </div>

      <div className="story-footer animate-left delay-7">
        <span className="footer-line" />
        <p>
          A smarter industry for
          <br />
          a better tomorrow.
        </p>
      </div>
    </div>
  </section>

      <section className="svma-login-form-panel">
        <div className="svma-login-card">
          <div className="login-brand">
            <img
              src="/svma-logo2.png"
              alt="SVMA Intelligence"
              className="premium-login-logo"
            />
            <span className="login-brand-line" />
          </div>

          <div className="login-heading">
            <span className="login-kicker">INTELLIGENT OPERATIONS</span>
            <h2>Welcome back</h2>
            <p>Sign in to your account to continue to your workspace.</p>
          </div>

          <form onSubmit={submit} className="login-form">
            <label className="field" htmlFor="email">
              <span>Email address</span>
              <div className="input-shell">
                <Mail size={19} />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="name@company.com"
                />
              </div>
            </label>

            <label className="field" htmlFor="password">
              <span>Password</span>
              <div className="input-shell">
                <LockKeyhole size={19} />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Enter your password"
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </label>

            <div className="login-options">
              <label className="remember-option">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span>Remember me</span>
              </label>

             
            </div>

            {message && (
              <div
                className={`login-notice ${
                  message.startsWith('Signed in') ? 'success' : ''
                }`}
                role="status"
                aria-live="polite"
              >
                {message}
              </div>
            )}

            <button
              className="premium-login-button"
              type="submit"
              disabled={loading}
            >
              <span>{loading ? 'Signing in…' : 'Sign in'}</span>
              {!loading && <ArrowRight size={20} />}
            </button>
          </form>

          <div className="login-security">
            <ShieldCheck size={17} />
            <span>Protected enterprise access</span>
          </div>

          <div className="login-powered">
            <span>Powered by</span>
            <img src="/uruv_logo.png" alt="Uruv.ai" />
          </div>
        </div>
      </section>
    </main>
  );
}
