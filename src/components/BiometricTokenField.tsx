import React from 'react';
import { KeyRound } from 'lucide-react';

interface BiometricTokenFieldProps {
  token: string;
  onChange: (token: string) => void;
}

// API-token input shared by both biometric pages. The engine needs a Bearer
// JWT signed with its own secret, which the mock auth cannot mint, so the
// user pastes one (persisted to localStorage by the caller).
const BiometricTokenField: React.FC<BiometricTokenFieldProps> = ({ token, onChange }) => {
  return (
    <div>
      <label htmlFor="biometric-token" className="block text-sm font-medium text-gray-700 mb-2">
        Biometric API token
      </label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <KeyRound className="h-5 w-5 text-gray-400" />
        </div>
        <input
          id="biometric-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Paste the engine JWT here"
          className="block w-full px-3 py-2 pl-10 border border-gray-300 rounded-md shadow-sm placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
        />
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Mint one with the engine secret: from biometric_engine/ run
        <code className="ml-1 px-1 py-0.5 bg-gray-100 rounded text-gray-700">
          .venv/bin/python -c &quot;from app.core.security import create_access_token;
          print(create_access_token(&apos;frontend-qa&apos;))&quot;
        </code>
      </p>
    </div>
  );
};

export default BiometricTokenField;
