"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Download,
  Film,
  Sparkles,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Layers,
  Video,
  MonitorPlay,
  Share2,
} from "lucide-react";
import SceneCanvas from "./SceneCanvas";
import { usePlayback } from "@/hooks/usePlayback";
import { useVoiceover } from "@/hooks/useVoiceover";
import type { NiftyStockItem } from "@/lib/niftyShortsService";

interface VideoBrief {
  title: string;
  total_seconds: number;
  tone: string;
  format?: string;
  scenes: any[];
  disclaimer: string;
  video_url?: string;
}

interface NiftyShortVideoModalProps {
  stock: NiftyStockItem;
  videoUrl: string | null;
  videoBrief?: VideoBrief | null;
  isRendering?: boolean;
  onClose: () => void;
  onRender: (force?: boolean) => Promise<void>;
}

function fmt(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function AudioWaveIndicator() {
  return (
    <div className="flex items-center gap-[2px]">
      {[0, 0.15, 0.3, 0.1, 0.25].map((delay, i) => (
        <div
          key={i}
          className="audio-wave-bar"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </div>
  );
}

export default function NiftyShortVideoModal({
  stock,
  videoUrl,
  videoBrief: initialBrief,
  isRendering = false,
  onClose,
  onRender,
}: NiftyShortVideoModalProps) {
  const [viewMode, setViewMode] = useState<"interactive" | "mp4">("interactive");
  const [brief, setBrief] = useState<VideoBrief | null>(initialBrief || null);
  const [loadingBrief, setLoadingBrief] = useState(!initialBrief);
  const [voiceOn, setVoiceOn] = useState(true);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Fetch or build VideoBrief if not already loaded
  useEffect(() => {
    if (initialBrief) {
      setBrief(initialBrief);
      setLoadingBrief(false);
      return;
    }

    if (isRendering) {
      // Parent page is actively rendering and will supply videoBrief/videoUrl when complete
      return;
    }

    let isCancelled = false;
    const loadBrief = async () => {
      setLoadingBrief(true);
      try {
        const res = await fetch("/api/nifty-shorts/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: stock.symbol, force: false }),
        });
        const json = await res.json();
        if (!isCancelled && json.success && json.data) {
          if (json.data.video_brief) {
            setBrief(json.data.video_brief);
          }
        }
      } catch (e) {
        console.error("Failed to fetch brief:", e);
      } finally {
        if (!isCancelled) setLoadingBrief(false);
      }
    };

    loadBrief();
    return () => {
      isCancelled = true;
    };
  }, [stock.symbol, initialBrief, isRendering]);

  // Voiceover setup (timing strictly governed by sceneDur to avoid premature jump cascades)
  const voiceover = useVoiceover({
    enabled: voiceOn,
    preference: "en-IN-W",
  });

  // Scene change handler (sync audio)
  const handleSceneChange = useCallback(
    (sceneIdx: number) => {
      if (!brief?.scenes) return;
      const sc = brief.scenes[sceneIdx];
      if (!sc?.narration || !voiceOn) {
        voiceover.stop();
        return;
      }
      voiceover.speak(sc.narration, sc.audio_url);
    },
    [brief, voiceover, voiceOn]
  );

  // Playback hook
  const pb = usePlayback(brief?.scenes ?? [], {
    onSceneChange: handleSceneChange,
  });

  // Soft background music reference for Live Engine mode
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const audio = new Audio("/audio/background-music.mp3");
      audio.loop = true;
      audio.volume = 0.12; // 12% volume — soft bed under voiceover
      
      const handleEnded = () => {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      };
      audio.addEventListener("ended", handleEnded);
      bgMusicRef.current = audio;

      return () => {
        audio.removeEventListener("ended", handleEnded);
        audio.pause();
        audio.currentTime = 0;
        bgMusicRef.current = null;
      };
    }
  }, []);

  // Sync background music with playback state
  useEffect(() => {
    if (!bgMusicRef.current) return;
    if (pb.isPlaying && viewMode === "interactive") {
      bgMusicRef.current.play().catch(() => {});
    } else {
      bgMusicRef.current.pause();
    }
  }, [pb.isPlaying, viewMode]);

  // Stop audio on close or mode switch
  useEffect(() => {
    return () => {
      if (bgMusicRef.current) {
        bgMusicRef.current.pause();
      }
      voiceover.stop();
      pb.pause();
    };
  }, []);

  const totalScenes = brief?.scenes?.length || 0;
  const currentSceneData = brief?.scenes?.[pb.currentScene] || null;
  const totalDur = pb.totalDuration || brief?.total_seconds || 60;

  const handleTogglePlay = useCallback(() => {
    if (pb.isPlaying) {
      pb.pause();
      voiceover.stop();
    } else {
      pb.play();
      if (currentSceneData?.narration && voiceOn) {
        voiceover.speak(currentSceneData.narration, currentSceneData.audio_url);
      }
    }
  }, [pb, voiceover, currentSceneData, voiceOn]);


  const subtitleProgress =
    voiceOn && voiceover.isSpeaking
      ? Math.min(Math.max((voiceover.progress || 0) * 100, 0), 100)
      : pb.sceneProgress;

  const isUp = (stock.change_pct || 0) >= 0;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[420px] bg-[#0c1017] border border-slate-800/80 rounded-3xl overflow-hidden shadow-2xl flex flex-col items-center max-h-[96vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="w-full flex items-center justify-between px-4 py-3 bg-[#111622] border-b border-slate-800/80 text-white">
          <div className="flex items-center gap-2">
            <span className="font-display tracking-wider text-amber-400 font-bold text-base">
              {stock.symbol}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
              ₹{(stock.price || 0).toLocaleString("en-IN")}
            </span>
            <span
              className={`text-[10px] font-mono font-semibold flex items-center gap-0.5 ${
                isUp ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {isUp ? "+" : ""}
              {(stock.change_pct || 0).toFixed(2)}%
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {videoUrl && (
              <a
                href={videoUrl}
                download={`${stock.symbol}_short.mp4`}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                title="Download MP4"
              >
                <Download className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* View Mode Toggle: Interactive Live Engine vs Rendered MP4 */}
        <div className="w-full px-4 pt-2.5 pb-1 flex items-center justify-between bg-[#0e131d]">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-900 border border-slate-800">
            <button
              onClick={() => {
                setViewMode("interactive");
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                viewMode === "interactive"
                  ? "bg-amber-500 text-black shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="w-3 h-3" />
              Live Engine
            </button>
            <button
              onClick={() => {
                voiceover.stop();
                pb.pause();
                setViewMode("mp4");
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                viewMode === "mp4"
                  ? "bg-amber-500 text-black shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Film className="w-3 h-3" />
              Saved MP4
            </button>
          </div>

          <button
            onClick={() => onRender(true)}
            disabled={isRendering}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-mono text-amber-400 hover:text-amber-300 disabled:opacity-50 transition-colors"
            title="Re-render 1080p MP4 headless video"
          >
            <RefreshCw className={`w-3 h-3 ${isRendering ? "animate-spin" : ""}`} />
            {isRendering ? "Rendering..." : "Re-render"}
          </button>
        </div>

        {/* Video Player Core / Phone Mockup Container */}
        <div className="w-full flex flex-col items-center px-4 py-2">
          {viewMode === "interactive" ? (
            /* ── INTERACTIVE LIVE ENGINE PLAYER (EXACT ET-VIDEO-ENGINE REPLICA) ── */
            <div className="flex flex-col items-center w-full">
              {/* Phone Frame */}
              <div
                className="relative w-[270px] h-[480px] rounded-[32px] border-2 border-slate-700/80
                           overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.9),inset_0_0_0_1px_rgba(255,255,255,0.05)]
                           bg-[#080d14]"
              >
                {/* Speaker notch */}
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-16 h-1 rounded-full bg-slate-800/80 z-40 pointer-events-none" />

                {loadingBrief ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[#0a0f18] text-center p-4">
                    <RefreshCw className="w-6 h-6 text-amber-500 animate-spin" />
                    <span className="text-xs font-mono text-slate-400">Loading scene visuals...</span>
                  </div>
                ) : (
                  <SceneCanvas
                    scene={currentSceneData}
                    tone={brief?.tone || "neutral"}
                    format={brief?.format || "daily_wrap"}
                    disclaimer={brief?.disclaimer || "Educational commentary"}
                    sceneIndex={pb.currentScene}
                    totalScenes={totalScenes}
                    subtitleProgress={subtitleProgress}
                  />
                )}
              </div>

              {/* Global Progress Bar */}
              <div className="w-[270px] mt-3">
                <div className="h-[3px] bg-slate-800 rounded-full overflow-hidden mb-1">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full transition-[width] duration-100 ease-linear"
                    style={{ width: `${pb.totalProgress}%` }}
                  />
                </div>
                <div className="flex justify-between font-mono text-[10px] text-slate-400">
                  <span>{fmt(pb.elapsed)}</span>
                  <span>{fmt(totalDur)}</span>
                </div>
              </div>

              {/* Per-scene timer + Scene Counter */}
              <div className="w-[270px] flex items-center gap-2 mt-1">
                <div className="flex-1 h-[2px] bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-[width] duration-100 ease-linear"
                    style={{ width: `${pb.sceneProgress}%` }}
                  />
                </div>
                <div className="font-mono text-[10px] text-amber-400/90 whitespace-nowrap">
                  {brief ? `${pb.currentScene + 1}/${totalScenes}` : "-/-"}
                </div>
              </div>

              {/* Playback Controls & Voiceover Toggle */}
              <div className="w-[270px] flex items-center justify-between mt-2.5">
                {/* Voiceover Button & Equalizer */}
                <button
                  onClick={() => {
                    const next = !voiceOn;
                    setVoiceOn(next);
                    if (!next) voiceover.stop();
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300 hover:text-white transition-colors"
                >
                  {voiceOn ? (
                    <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  <span>Voice</span>
                  {voiceOn && voiceover.isSpeaking && <AudioWaveIndicator />}
                </button>

                {/* Media Play / Step Controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={pb.prev}
                    disabled={!brief || pb.currentScene === 0}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <SkipBack className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={handleTogglePlay}
                    disabled={!brief}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold shadow-md hover:scale-105 active:scale-95 disabled:opacity-40 transition-all"
                  >

                    {pb.isPlaying ? (
                      <Pause className="w-4 h-4 fill-black" />
                    ) : (
                      <Play className="w-4 h-4 fill-black ml-0.5" />
                    )}
                  </button>

                  <button
                    onClick={pb.next}
                    disabled={!brief || pb.currentScene >= totalScenes - 1}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Scene Jumper Pills */}
              {brief?.scenes && (
                <div className="w-[280px] flex items-center justify-center gap-1 mt-2.5 overflow-x-auto py-1">
                  {brief.scenes.map((sc, idx) => (
                    <button
                      key={sc.id || idx}
                      onClick={() => pb.jumpTo(idx)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all ${
                        pb.currentScene === idx
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                          : "text-slate-400 hover:text-slate-200 bg-slate-900/60"
                      }`}
                    >
                      {sc.visual_type === "price_ticker"
                        ? "Price"
                        : sc.visual_type === "bar_chart"
                        ? "Metrics"
                        : sc.visual_type === "gauge"
                        ? "RSI"
                        : sc.type === "intro"
                        ? "Intro"
                        : sc.type === "outro"
                        ? "Verdict"
                        : `S${idx + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── SAVED MP4 VIDEO MODE ── */
            <div className="flex flex-col items-center w-full">
              <div
                className="relative w-[270px] h-[480px] rounded-[32px] border-2 border-slate-700/80
                           overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.9),inset_0_0_0_1px_rgba(255,255,255,0.05)]
                           bg-black flex items-center justify-center"
              >
                {videoUrl ? (
                  <video
                    src={videoUrl}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 p-6 text-center text-slate-400">
                    <Film className="w-8 h-8 text-amber-500 animate-pulse" />
                    <p className="text-xs">No MP4 rendered yet for today.</p>
                    <button
                      onClick={() => onRender(true)}
                      className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs transition-colors"
                    >
                      Render MP4 Now
                    </button>
                  </div>
                )}
              </div>

              {videoUrl && (
                <div className="w-[270px] flex items-center justify-between mt-3 text-xs font-mono text-slate-400">
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    1080x1920 MP4 Ready
                  </span>
                  <a
                    href={videoUrl}
                    download={`${stock.symbol}_short.mp4`}
                    className="text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Save Video
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info banner */}
        <div className="w-full px-4 py-2 bg-[#0e131d] border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
          <span>{stock.company_name}</span>
          <span className="text-amber-500/90 font-semibold">ET Video Engine</span>
        </div>
      </div>
    </div>
  );
}
