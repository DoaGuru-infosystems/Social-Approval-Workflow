import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import Button from '../components/Button';
import postService from '../services/postService';
import { SERVER_URL } from '../utils/constants';
import { formatDate } from '../utils/helpers';
import { useToast } from '../context/ToastContext';
import {
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
  XCircle,
  RotateCcw,
  Sparkles,
  User,
  Clock,
  Quote,
  AlertTriangle,
  Building2,
  AlertOctagon,
} from 'lucide-react';

const ManagerDashboard = () => {
  const { showToast } = useToast();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeActionId, setActiveActionId] = useState(null);
  const [comments, setComments] = useState({});

  useEffect(() => {
    fetchReviewQueue();
  }, []);

  const fetchReviewQueue = async () => {
    setLoading(true);
    try {
      const data = await postService.getPosts();
      const list = Array.isArray(data) ? data : data?.posts || [];
      // Filter for posts pending manager review
      setPosts(list.filter((p) => p.status === 'pending_manager'));
    } catch {
      showToast('Unable to load the manager review queue.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleReviewAction = async (postId, action) => {
    setActiveActionId(`${action}-${postId}`);
    try {
      const comment = (comments[postId] || '').trim();
      await postService.managerReview(postId, { action, comment });

      if (action === 'approve') {
        showToast(`Post #${postId} was approved and sent to the Admin for review.`, 'success');
      } else if (action === 'reject') {
        showToast(`Post #${postId} was rejected and permanently closed.`, 'warning');
      } else {
        showToast(`The change request for post #${postId} was sent back to the SMO.`, 'success');
      }

      // Remove from queue
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (err) {
      const msg = err.response?.data?.message || 'Unable to process the review. Please try again.';
      showToast(msg, 'error');
    } finally {
      setActiveActionId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#2B2A27] pb-16">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-800">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-[#2B2A27]">
                Manager Review Pipeline
              </h1>
            </div>
            <p className="text-sm text-[#6B6A63] mt-1">
              Verify AI checks, quality guidelines, and decide: Approve, Request Changes, or Reject.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            loading={loading}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            onClick={fetchReviewQueue}
          >
            Refresh Queue
          </Button>
        </div>

        {/* Loading Skeleton */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2].map((n) => (
              <div
                key={n}
                className="bg-stone-100 rounded-3xl p-6 border border-[#E5E2DA] animate-pulse space-y-4"
              >
                <div className="flex justify-between items-center">
                  <div className="h-4 bg-stone-200 rounded w-24"></div>
                  <div className="h-4 bg-stone-200 rounded w-28"></div>
                </div>
                <div className="h-48 bg-stone-200 rounded-2xl"></div>
                <div className="h-4 bg-stone-200 rounded w-3/4"></div>
                <div className="h-10 bg-stone-200 rounded-xl"></div>
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          /* Empty State */
          <div className="bg-[#FFFFFF] rounded-3xl p-14 border border-[#E5E2DA] text-center max-w-xl mx-auto mt-8 shadow-xs">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 mx-auto flex items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-[#2B2A27]">No posts are currently pending review</h3>
            <p className="text-xs text-[#6B6A63] mt-1.5 max-w-sm mx-auto">
              All submissions have been processed. New posts submitted by an SMO will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {posts.map((post) => {
              const rawImg = post.image_path || post.latest_revision?.image_path;
              const imgSrc = rawImg ? `${SERVER_URL}/${rawImg}` : null;
              const aiReport = post.latest_ai_check;
              const spellingIssues = aiReport?.spelling_issues || [];
              const bannedWords = aiReport?.banned_words_found || [];
              const missingMandatory = aiReport?.missing_mandatory_phrases || [];
              const ocrText = aiReport?.ocr_extracted_text;
              const isActionActive = activeActionId !== null;

              return (
                <div
                  key={post.id}
                  className="bg-[#FFFFFF] rounded-3xl border border-[#E5E2DA] overflow-hidden shadow-xs flex flex-col justify-between"
                >
                  <div>
                    {/* Header */}
                    <div className="p-4 border-b border-[#E5E2DA] space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#2B2A27] bg-stone-100 border border-[#E5E2DA] px-2.5 py-0.5 rounded-md font-mono">
                            #{post.id}
                          </span>
                          <span className="text-xs text-[#2B2A27] font-medium flex items-center gap-1.5 bg-stone-50 px-2.5 py-0.5 rounded-lg border border-[#E5E2DA]">
                            <User className="w-3 h-3 text-emerald-600" />
                            SMO: {post.smo_name || post.creator_name || 'SMO'}
                          </span>
                        </div>
                        <span className="text-xs text-[#6B6A63] flex items-center gap-1">
                          <Clock className="w-3 h-3 text-[#A8A29E]" />
                          {formatDate(post.created_at)}
                        </span>
                      </div>

                      {/* Client Badge & Title */}
                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {post.client_name || 'Client'}
                        </span>
                        <h4 className="text-sm font-bold text-[#2B2A27] line-clamp-1">
                          {post.title}
                        </h4>
                      </div>
                    </div>

                    {/* Creative Visual */}
                    {imgSrc && (
                      <div className="bg-stone-50 border-b border-[#E5E2DA] max-h-60 overflow-hidden flex items-center justify-center p-1">
                        <img
                          src={imgSrc}
                          alt="Creative preview"
                          className="w-full h-full max-h-60 object-contain rounded-xl"
                        />
                      </div>
                    )}

                    {/* Content */}
                    <div className="p-5 space-y-4">
                      <div>
                        <span className="text-[11px] text-[#6B6A63] uppercase tracking-wider font-semibold block mb-1">
                          Post Caption:
                        </span>
                        <p className="text-sm text-[#2B2A27] leading-relaxed whitespace-pre-wrap">
                          {post.caption || <span className="italic text-[#A8A29E]">No caption</span>}
                        </p>
                      </div>

                      {/* AI Report Card */}
                      {aiReport && (
                        <div className="rounded-2xl p-4 bg-[#FAF9F6] border border-[#E5E2DA] space-y-2.5">
                          <div className="flex items-center justify-between text-xs font-semibold text-emerald-800">
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                              Hindi and English AI & Brand Rules Check
                            </span>
                            <span className="text-[#6B6A63] font-mono text-[11px]">
                              Rechecks: {post.recheck_count}/3
                            </span>
                          </div>

                          {/* BANNED WORDS ALERT */}
                          {bannedWords.length > 0 && (
                            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                              <AlertOctagon className="w-4 h-4 shrink-0 text-rose-600" />
                              <span>
                                <strong>Banned Brand Words:</strong> {bannedWords.join(', ')}
                              </span>
                            </div>
                          )}

                          {/* MISSING MANDATORY PHRASE ALERT */}
                          {missingMandatory.length > 0 && (
                            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                              <span>
                                <strong>Missing Required Phrase:</strong> {missingMandatory.join(', ')}
                              </span>
                            </div>
                          )}

                          {/* Misspelled list */}
                          {spellingIssues.length > 0 ? (
                            <div className="space-y-1 pt-1">
                              <span className="text-xs text-rose-700 font-semibold block">
                                Spelling issues found ({spellingIssues.length}):
                              </span>
                              {spellingIssues.map((issue, idx) => (
                                <div
                                  key={idx}
                                  className="text-xs px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-center justify-between"
                                >
                                  <div className="flex items-center gap-2">
                                    {issue.script && (
                                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-stone-200 text-stone-700">
                                        {issue.script}
                                      </span>
                                    )}
                                    <span className="line-through font-mono text-rose-700">
                                      {issue.word}
                                    </span>
                                  </div>
                                  {issue.suggestions?.length > 0 && (
                                    <span className="text-emerald-700 font-medium">
                                      → {issue.suggestions.slice(0, 3).join(', ')}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-emerald-800 flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                              <span>No Hindi or English spelling issues were found.</span>
                            </p>
                          )}

                          {/* OCR Quoted Box */}
                          {ocrText && (
                            <div className="text-xs text-[#6B6A63] pt-2 border-t border-[#E5E2DA]">
                              <span className="font-semibold text-[#2B2A27] flex items-center gap-1 mb-1">
                                <Quote className="w-3 h-3 text-emerald-600" />
                                Image OCR Text (English + Hindi):
                              </span>
                              <div className="p-2 rounded-xl bg-white border border-[#E5E2DA] font-mono text-[#2B2A27] text-[11px]">
                                "{ocrText}"
                              </div>
                            </div>
                          )}

                          {/* High-priority Manual Review Required Badge */}
                          {Boolean(post.manual_review_required || post.recheck_count >= 3) && (
                            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
                              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                              <span>AI recheck limit reached (3/3). The SMO has used all attempts. Review this post manually.</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Optional Review Comment */}
                      <div>
                        <input
                          type="text"
                          value={comments[post.id] || ''}
                          onChange={(e) =>
                            setComments({ ...comments, [post.id]: e.target.value })
                          }
                          placeholder="Optional feedback / note (e.g. caption changes or clearance notes)..."
                          className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF9F6] border border-[#E5E2DA] text-xs text-[#2B2A27] placeholder-[#A8A29E] focus:outline-none focus:border-amber-600 focus:bg-white"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="p-4 bg-stone-50 border-t border-[#E5E2DA] flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      className="flex-1"
                      leftIcon={<XCircle className="w-3.5 h-3.5" />}
                      loading={activeActionId === `reject-${post.id}`}
                      disabled={isActionActive}
                      onClick={() => handleReviewAction(post.id, 'reject')}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 text-amber-800 hover:text-amber-900 border-[#E5E2DA] hover:border-amber-300 bg-white"
                      leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
                      loading={activeActionId === `changes_requested-${post.id}`}
                      disabled={isActionActive}
                      onClick={() => handleReviewAction(post.id, 'changes_requested')}
                    >
                      Request Changes
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      className="flex-1 !bg-emerald-600 hover:!bg-emerald-700"
                      leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                      loading={activeActionId === `approve-${post.id}`}
                      disabled={isActionActive}
                      onClick={() => handleReviewAction(post.id, 'approve')}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default ManagerDashboard;
