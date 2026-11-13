import React, { useRef, useState } from 'react';
import { UploadCloud, X, AlertCircle } from 'lucide-react';

const ImageUpload = ({ onImageSelect, previewUrl, onRemove, onError }) => {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState(null);

  const validateAndProcessFile = (file) => {
    setLocalError(null);
    if (!file) return;

    // Check file type: only jpg, jpeg, png
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
      const err = 'Sirf JPG, JPEG ya PNG format ki images allowed hain.';
      setLocalError(err);
      if (onError) onError(err);
      return;
    }

    // Check size limit: 10MB
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      const err = 'Image ka size 10MB se zyada hai. Kripya 10MB se chhoti image chunein.';
      setLocalError(err);
      if (onError) onError(err);
      return;
    }

    onImageSelect(file);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      validateAndProcessFile(file);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      validateAndProcessFile(file);
    }
  };

  const handleClear = () => {
    setLocalError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onRemove();
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-semibold text-[#2B2A27] uppercase tracking-wider">
          Creative / Image File <span className="text-emerald-600 font-bold">*</span>
        </label>
        {previewUrl && (
          <span className="text-[11px] text-emerald-700 font-semibold">✓ Image Selected</span>
        )}
      </div>

      {previewUrl ? (
        <div className="relative rounded-2xl border border-[#E5E2DA] overflow-hidden bg-stone-50 group">
          <img
            src={previewUrl}
            alt="Upload Preview"
            className="w-full max-h-72 object-contain mx-auto p-1"
          />
          <button
            type="button"
            onClick={handleClear}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-white/90 hover:bg-rose-600 text-[#6B6A63] hover:text-white transition-colors cursor-pointer shadow-md border border-[#E5E2DA]"
            title="Image hatayein"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-7 text-center cursor-pointer transition-all duration-150 ${
            isDragging
              ? 'border-emerald-500 bg-emerald-50/60'
              : 'border-[#E5E2DA] hover:border-emerald-500/60 bg-[#FFFFFF] hover:bg-stone-50/60'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            className="hidden"
          />
          <div className="flex flex-col items-center justify-center gap-2.5">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 border border-[#E5E2DA] flex items-center justify-center text-emerald-600">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-[#2B2A27]">
                <span className="text-emerald-600 font-semibold hover:underline">
                  Click to select creative
                </span>{' '}
                or drag & drop
              </p>
              <p className="text-xs text-[#6B6A63] mt-1">PNG, JPG, JPEG (Max 10MB)</p>
            </div>
          </div>
        </div>
      )}

      {localError && (
        <div className="mt-2 text-xs text-rose-700 flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{localError}</span>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
