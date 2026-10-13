import React from 'react';
import { Link } from 'react-router-dom';
import LogoUploader from '../components/LogoUploader';
import Logo from '../components/Logo';
import { ArrowLeft, Settings as SettingsIcon, ScanFace } from 'lucide-react';

const Settings: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link
            to="/dashboard"
            className="inline-flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back to Dashboard
          </Link>
        </div>

        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center">
              <SettingsIcon className="h-6 w-6 text-gray-600 mr-2" />
              <h2 className="text-xl font-semibold text-gray-900">Platform Settings</h2>
            </div>
          </div>

          <div className="p-6">
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Company Branding</h3>
              <div className="mb-6">
                <p className="text-sm text-gray-600 mb-4">Current Logo:</p>
                <Logo className="mb-4" />
              </div>
              <LogoUploader />
            </div>

            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">Biometrics</h3>
              <Link
                to="/settings/biometric-enroll"
                className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                <ScanFace className="h-4 w-4 mr-2" />
                Enroll your face
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;