import React from 'react';
import { Link } from 'react-router-dom';
import LogoUploader from '../components/LogoUploader';
import Logo from '../components/Logo';
import { Card } from '../components/ui';
import { ArrowLeft, ScanFace } from 'lucide-react';

// Settings: paper canvas, mist section cards. Branding (Logo + uploader)
// and a biometrics link card to /settings/biometric-enroll.
const Settings: React.FC = () => {
  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto w-full max-w-page px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <Link
            to="/dashboard"
            className="inline-flex min-h-[44px] items-center font-medium text-ink hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30"
          >
            <ArrowLeft className="mr-2 h-5 w-5" aria-hidden="true" />
            Back to Dashboard
          </Link>
        </div>

        <h1 className="font-display text-[40px] font-normal leading-[1.15] text-ink">
          Platform Settings
        </h1>
        <p className="mt-2 max-w-[65ch] text-base font-normal leading-[1.5] text-ink/60">
          Brand the workspace and manage face enrollment for the biometric engine.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-6">
          <Card variant="mist" padding="lg">
            <h2 className="font-serif text-[28px] font-normal leading-[1.25] text-ink">
              Company Branding
            </h2>
            <div className="mt-6">
              <p className="text-sm font-medium text-ink">Current Logo:</p>
              <div className="mt-4 rounded-card border border-faded bg-paper p-6">
                <Logo className="mb-0" />
              </div>
            </div>
            <div className="mt-6">
              <LogoUploader />
            </div>
          </Card>

          <Card variant="mist" padding="lg">
            <h2 className="font-serif text-[28px] font-normal leading-[1.25] text-ink">
              Biometrics
            </h2>
            <p className="mt-2 max-w-[65ch] text-base font-normal leading-[1.5] text-ink/60">
              Enroll a face in the engine, then verify it at sign-in. The engine
              enforces a 0.7 quality gate and a per-user rate limit.
            </p>
            <div className="mt-6">
              <Link
                to="/settings/biometric-enroll"
                aria-label="Enroll your face"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-pill border border-iris bg-transparent px-6 py-3.5 text-base font-medium text-iris transition-colors hover:bg-iris/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30 focus-visible:ring-offset-2"
              >
                <ScanFace className="h-4 w-4" aria-hidden="true" />
                Enroll your face
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Settings;
