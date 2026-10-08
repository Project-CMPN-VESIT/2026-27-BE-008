import React from 'react'
import { Series, Audio, AbsoluteFill, staticFile, useCurrentFrame, Img, Loop } from 'remotion'
import SceneCanvas from '../components/SceneCanvas'

function SceneSequence({ scene, tone, format, disclaimer, sceneIndex, totalScenes, durationInFrames }) {
  const frame = useCurrentFrame()
  const subtitleProgress = durationInFrames > 0
    ? Math.min(((frame + 1) / durationInFrames) * 100, 100)
    : 0

  // Resolve image URL for Remotion CLI bundle
  const resolvedImageUrl = scene.image_url
    ? (scene.image_url.startsWith('http')
        ? scene.image_url
        : staticFile(scene.image_url.replace(/^\//, '')))
    : null

  const remotionScene = resolvedImageUrl
    ? { ...scene, image_url: resolvedImageUrl }
    : scene

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#060a10' }}>
      {/* High-res background image layer: Remotion Img pauses rendering until decoded */}
      {resolvedImageUrl && (
        <AbsoluteFill style={{ zIndex: 0, opacity: 0.22, overflow: 'hidden' }}>
          <Img
            src={resolvedImageUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </AbsoluteFill>
      )}

      {/* 
        SceneCanvas is designed for a 360x640 mobile viewport.
        Scaling 3x perfectly maps 360x640 to 1080x1920 (exact 9:16 aspect ratio).
        This ensures all font sizes, badges, charts, gauges, and subtitles
        are properly proportioned without any misalignment or tiny text.
      */}
      <div
        style={{
          width: 360,
          height: 640,
          transform: 'scale(3)',
          transformOrigin: 'top left',
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 1,
        }}
      >
        <SceneCanvas
          scene={remotionScene}
          tone={tone}
          format={format}
          disclaimer={disclaimer}
          sceneIndex={sceneIndex}
          totalScenes={totalScenes}
          subtitleProgress={subtitleProgress}
        />
      </div>

      {scene.audio_url && (
        <Audio
          src={staticFile(scene.audio_url.replace(/^\//, ''))}
        />
      )}
    </AbsoluteFill>
  )
}

export const VideoComposition = ({ videoBrief }) => {
  if (!videoBrief || !videoBrief.scenes) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000', color: 'red', placeItems: 'center' }}>
        No videoBrief data provided.
      </AbsoluteFill>
    )
  }

  const FPS = 30
  // background-music.mp3 length is ~137s (4118 frames at 30fps)
  const BG_TRACK_FRAMES = 4118
  
  return (
    <AbsoluteFill className="bg-[#0f172a]">
      {/* Soft background music track ducked at 12% volume, seamlessly looped throughout */}
      <Loop durationInFrames={BG_TRACK_FRAMES}>
        <Audio
          src={staticFile('audio/background-music.mp3')}
          volume={0.12}
        />
      </Loop>

      <Series>
        {videoBrief.scenes.map((scene, idx) => {
          const duration = scene.duration_seconds || 5
          const frames = duration * FPS

          return (
            <Series.Sequence key={scene.id || idx} durationInFrames={frames}>
              <SceneSequence
                scene={scene}
                tone={videoBrief.tone}
                format={videoBrief.format}
                disclaimer={videoBrief.disclaimer}
                sceneIndex={idx}
                totalScenes={videoBrief.scenes.length}
                durationInFrames={frames}
              />
            </Series.Sequence>
          )
        })}
      </Series>
    </AbsoluteFill>
  )
}
