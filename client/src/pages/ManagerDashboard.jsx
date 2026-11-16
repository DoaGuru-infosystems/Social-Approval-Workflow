import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import Button from '../components/Button';
import postService from '../services/postService';
import { SERVER_URL } from '../utils/constants';
import { formatDate } from '../utils/helpers';
import { useToast } from '../context/ToastContext';
import AnnotatedPosterOCR from '../components/AnnotatedPosterOCR';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
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
  Phone,
  MapPin,
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

                          {/* KEY ERROR / FALLBACK NOTIFICATION BANNER */}
                          {aiReport.key_error && (
                            <div className="p-3 bg-amber-50 border-l-4 border-amber-500 rounded-xl text-amber-900 text-xs flex items-start justify-between gap-2 shadow-sm">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="font-semibold text-amber-900">
                                    ⚠️ {aiReport.key_error.user_message}
                                  </p>
                                  <p className="text-[11px] text-amber-700 mt-0.5">
                                    Service: {aiReport.key_error.service} | Status: Fallback Active
                                  </p>
                                </div>
                              </div>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-mono font-bold whitespace-nowrap">
                                {aiReport.key_error.code}
                              </span>
                            </div>
                          )}

                          {/* GEMINI KEY EXPIRED / ERROR RED CHIP */}
                          {aiReport.grammar_suggestions && aiReport.grammar_suggestions.some((g) => g.type === 'grammar_error') && (
                            <div className="p-2.5 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-xs flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                                <span><strong>Grammar Check unavailable:</strong> Gemini Key expired / invalid</span>
                              </div>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-rose-200 text-rose-900 font-mono font-bold">
                                GEMINI_KEY_EXPIRED
                              </span>
                            </div>
                          )}

                          {/* GRAMMAR SUGGESTIONS CHIP (Gemini Powered) */}
                          {aiReport.grammar_suggestions && aiReport.grammar_suggestions.filter((g) => g.type !== 'grammar_error').length > 0 && (
                            <div className="space-y-1.5 pt-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-purple-800 bg-purple-100 border border-purple-200 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                                  <Sparkles className="w-3 h-3 text-purple-600" />
                                  Grammar Suggestion
                                </span>
                                <span className="text-[11px] text-purple-700 font-medium">
                                  Yahan kya sudhar sakte ho:
                                </span>
                              </div>
                              <div className="space-y-1">
                                {aiReport.grammar_suggestions
                                  .filter((g) => g.type !== 'grammar_error')
                                  .map((g, idx) => (
                                    <div
                                      key={idx}
                                      className="text-xs px-3 py-2 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 flex flex-col gap-0.5"
                                    >
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="line-through text-rose-700 font-mono font-medium">
                                          {g.original}
                                        </span>
                                        <span className="text-purple-600 font-bold">→</span>
                                        <span className="text-emerald-700 font-semibold font-mono">
                                          {g.suggestion}
                                        </span>
                                      </div>
                                      {g.reason && (
                                        <p className="text-[11px] text-purple-800 font-sans mt-0.5">
                                          {g.reason}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}

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

                          {/* BRAND IDENTITY ALERTS */}
                          {aiReport.brand_identity_check?.possible_brand_name_error && (
                            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                              <AlertOctagon className="w-4 h-4 shrink-0 text-rose-600" />
                              <span>
                                <strong>Brand Name Mismatch:</strong> {aiReport.brand_identity_check.possible_brand_name_error}
                              </span>
                            </div>
                          )}

                          {aiReport.brand_identity_check?.phone_verification?.filter((p) => p.status !== 'clean').map((pv, idx) => (
                            <div key={idx} className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                              <Phone className="w-4 h-4 shrink-0 text-rose-600" />
                              <span>
                                <strong>Phone Mismatch Alert:</strong> {pv.message}
                              </span>
                            </div>
                          ))}

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

                          {/* PaddleOCR Annotated Poster Box */}
                          {imgSrc && (
                            <div className="pt-2 border-t border-[#E5E2DA]">
                              <AnnotatedPosterOCR
                                imgSrc={imgSrc}
                                boxes={aiReport.ocr_issues || []}
                                ocrConfidence={aiReport.ocr_confidence}
                                rawOcrText={ocrText}
                                realErrors={spellingIssues.filter((s) => s.source === 'image')}
                              />
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
