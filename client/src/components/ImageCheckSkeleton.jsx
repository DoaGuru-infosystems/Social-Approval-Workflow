import React from 'react';
import { Sparkles, Image as ImageIcon, AlertCircle, RotateCcw, Loader2 } from 'lucide-react';
import Button from './Button';

/**
 * ImageCheckSkeleton Component
 * 
 * Displays an animated shimmering skeleton state while the background Remote PaddleOCR
 * and image brand rules check is processing (15-20 seconds).
 * Also displays an inline retry option if the image check fails or times out.
 * 
 * @param {Object} props
 * @param {'pending'|'failed'} [props.status='pending']
 * @param {string} [props.errorMessage]
 * @param {Function} [props.onRetry]
 * @param {boolean} [props.isRetrying=false]
 */
const ImageCheckSkeleton = ({
  status = 'pending',
  errorMessage = '',
  onRetry = null,
  isRetrying = false,
}) => {
  if (status === 'failed') {
    return (
      <div className="rounded-2xl p-4 bg-rose-50/50 border border-rose-200 text-rose-900 space-y-3 transition-all duration-300">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-rose-800 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            Image OCR Quality Check Failed
          </span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
            OCR Unavailable
          </span>
        </div>

        <p className="text-xs text-rose-700 leading-relaxed">
          {errorMessage || 'Remote OCR server timed out or could not read the image text. Your caption text check above remains valid.'}
        </p>

        {onRetry && (
          <div className="pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={onRetry}
              disabled={isRetrying}
              loading={isRetrying}
              leftIcon={<RotateCcw className="w-3.5 h-3.5 text-rose-700" />}
              className="!border-rose-300 !text-rose-800 hover:!bg-rose-100"
            >
              Retry Image Check Only
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-4 bg-[#FAF9F6] border border-[#E5E2DA] space-y-3.5 transition-all duration-300">
      {/* Header with background pulse indicator */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-spin" style={{ animationDuration: '3s' }} />
          Image OCR & Brand Check
        </span>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-100/80 border border-amber-200 text-[11px] font-medium text-amber-800">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
          <span>Checking in background (15-20s)...</span>
        </div>
      </div>

      {/* Bilingual friendly status notice */}
      <div className="p-3 rounded-xl bg-amber-50/90 border border-amber-200/90 text-amber-900 text-xs flex items-start gap-2.5 shadow-xs">
        <Loader2 className="w-4 h-4 shrink-0 text-amber-600 animate-spin mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-semibold text-amber-950 text-xs">
            Poster ka text padha ja raha hai... (15-20 sec)
          </p>
          <p className="text-[11px] text-amber-800 leading-normal">
            PaddleOCR image text scan kar raha hai. Text check upar already complete aur visible hai.
          </p>
        </div>
      </div>

      {/* Shimmer Image Placeholder Box */}
      <div className="h-28 w-full rounded-xl border border-[#E5E2DA] overflow-hidden relative animate-shimmer flex items-center justify-center">
        <div className="flex flex-col items-center gap-1 text-stone-400/80">
          <ImageIcon className="w-7 h-7" />
          <span className="text-[11px] font-mono tracking-tight text-stone-500">Scanning Image Poster...</span>
        </div>
      </div>

      {/* 3 Grey Shimmering Skeleton Lines */}
      <div className="space-y-2 pt-1">
        <div className="h-3.5 w-3/4 rounded-lg animate-shimmer"></div>
        <div className="h-3.5 w-full rounded-lg animate-shimmer"></div>
        <div className="h-3.5 w-1/2 rounded-lg animate-shimmer"></div>
      </div>
    </div>
  );
};

export default ImageCheckSkeleton;
