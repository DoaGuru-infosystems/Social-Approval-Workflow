import React from 'react';
import { formatDate, getStatusBadgeStyle } from '../utils/helpers';
import { PLATFORMS, SERVER_URL } from '../utils/constants';
import Button from './Button';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';

const PostCard = ({ post, onApprove, onReject, onViewDetails, showReviewActions = false }) => {
  const platform = PLATFORMS.find((p) => p.id === post.platform) || {
    name: post.platform || 'Social',
    tagClass: 'bg-stone-100 text-[#2B2A27] border border-[#E5E2DA]',
  };

  const rawImage = post.imageUrl || post.image_path;
  const imageSource = rawImage
    ? rawImage.startsWith('http') || rawImage.startsWith('blob:') || rawImage.startsWith('data:')
      ? rawImage
      : `${SERVER_URL}${rawImage.startsWith('/') ? '' : '/'}${rawImage}`
    : null;

  return (
    <div className="bg-[#FFFFFF] rounded-2xl border border-[#E5E2DA] hover:border-stone-400/80 shadow-xs transition-all duration-200 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-[#E5E2DA] flex items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-[#2B2A27] text-sm line-clamp-1">
            {post.clientName || 'General Client'}
          </h4>
          <span className="text-[11px] text-[#6B6A63] flex items-center gap-1 mt-0.5">
            <Clock className="w-3 h-3" />
            {formatDate(post.createdAt || new Date())}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Platform Badge */}
          <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${platform.tagClass}`}>
            {platform.name}
          </span>

          {/* Status Badge */}
          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${getStatusBadgeStyle(
              post.status
            )}`}
          >
            {post.status?.replace(/_/g, ' ') || 'Draft'}
          </span>
        </div>
      </div>

      {/* Image Preview (if present) */}
      {imageSource && (
        <div className="h-48 w-full bg-stone-50 overflow-hidden relative border-b border-[#E5E2DA]">
          <img
            src={imageSource}
            alt={post.caption || 'Post visual'}
            className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
          />
        </div>
      )}

      {/* Caption Content */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <p className="text-sm text-[#2B2A27] line-clamp-3 mb-2 leading-relaxed">
            {post.caption || 'No caption provided.'}
          </p>

          {post.hashtags && (
            <p className="text-xs text-emerald-700 font-medium line-clamp-1">
              {post.hashtags}
            </p>
          )}

          {/* AI Check summary badge if present */}
          {post.aiCheckResult && (
            <div className="mt-3 text-xs p-2.5 rounded-xl bg-stone-50 border border-[#E5E2DA]">
              <span className="font-semibold text-[#6B6A63]">AI Check: </span>
              <span
                className={
                  post.aiCheckResult.passed
                    ? 'text-emerald-700 font-medium'
                    : 'text-rose-700 font-medium'
                }
              >
                {post.aiCheckResult.summary || (post.aiCheckResult.passed ? 'Verified Clean' : 'Needs review')}
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-4 pt-3 border-t border-[#E5E2DA] flex items-center justify-between gap-2">
          {showReviewActions ? (
            <div className="flex items-center gap-2 w-full">
              <Button
                size="sm"
                variant="danger"
                className="flex-1"
                leftIcon={<XCircle className="w-3.5 h-3.5" />}
                onClick={() => onReject && onReject(post)}
              >
                Reject
              </Button>
              <Button
                size="sm"
                variant="primary"
                className="flex-1"
                leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                onClick={() => onApprove && onApprove(post)}
              >
                Approve
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => onViewDetails && onViewDetails(post)}
            >
              View Details
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PostCard;
