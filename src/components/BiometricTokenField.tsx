import React from 'react';
import { Input } from './ui';

// API-token input shared by both biometric pages. The engine needs a Bearer
// JWT signed with its own secret, which the mock auth cannot mint, so the
// user pastes one (persisted to localStorage key `biometric_api_token` by
// the caller via get/setBiometricToken).
interface BiometricTokenFieldProps {
  token: string;
  onChange: (token: string) => void;
}

const BiometricTokenField: React.FC<BiometricTokenFieldProps> = ({ token, onChange }) => {
  return (
    <Input
      id="biometric-token"
      label="Biometric API token"
      type="password"
      autoComplete="off"
      value={token}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Paste the engine JWT here"
      helper="Mint one with the engine secret (see biometric_engine README, Authentication section)."
    />
  );
};

export default BiometricTokenField;
