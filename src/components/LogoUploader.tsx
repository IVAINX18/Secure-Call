import React, { useRef } from 'react';
import { useLogo } from '../contexts/LogoContext';
import { Upload } from 'lucide-react';

// Logo dropzone: FileReader -> setLogo pipeline untouched; only the frame
// was restyled to the paper/mist system (1px border-faded, hover iris).
const LogoUploader: React.FC = () => {
  const { setLogo } = useLogo();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogo(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col items-center rounded-card border border-faded bg-paper p-6 transition-colors hover:border-iris">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
        aria-label="Choose a logo image"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Upload company logo"
        className="flex min-h-[44px] items-center justify-center gap-2 font-medium text-ink transition-colors hover:text-iris focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris/30"
      >
        <Upload className="h-6 w-6" aria-hidden="true" />
        <span>Upload Company Logo</span>
      </button>
      <p className="mt-2 text-sm font-normal text-ink/60">
        Recommended size: 200x50px, PNG or JPG
      </p>
    </div>
  );
};

export default LogoUploader;
