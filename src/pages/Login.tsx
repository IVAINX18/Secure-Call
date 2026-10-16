import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { AlertCircle } from 'lucide-react';
import Logo from '../components/Logo';
import { Button, Card, Input } from '../components/ui';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login, loading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    try {
      const success = await login(email, password);
      if (success) {
        navigate('/dashboard');
      } else {
        setError('Invalid email or password');
      }
    } catch (err) {
      setError('An error occurred during login');
    }
  };

  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      {/* Full-bleed blush hero band. */}
      <section className="bg-blush">
        <div className="max-w-page mx-auto px-6 py-12 md:py-16">
          <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-2 md:gap-16">
            {/* Left: editorial headline, display serif at the 40px floor. */}
            <div>
              <Logo />
              <h2 className="mt-6 font-display text-[40px] leading-[1.15] tracking-editorial text-ink md:text-[48px]">
                Sign in to SecureCall
              </h2>
              <p className="mt-4 text-base font-normal text-ink">
                Or{' '}
                <Link
                  to="/register"
                  className="font-medium text-ink hover:text-iris transition-colors"
                >
                  create a new account
                </Link>
              </p>
            </div>

            {/* Right: sign-in form on elevated paper card. */}
            <Card variant="paper" padding="lg" elevated>
              {error && (
                <div
                  role="alert"
                  className="mb-6 flex items-center gap-2 text-base font-medium text-ink"
                >
                  <AlertCircle size={16} aria-hidden="true" className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
                <Input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  label="Email address"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  label="Password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  loading={loading}
                  className="w-full min-h-[44px]"
                >
                  Sign in
                </Button>
              </form>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Login;
