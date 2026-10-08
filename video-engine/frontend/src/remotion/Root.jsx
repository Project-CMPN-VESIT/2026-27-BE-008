import { Composition, getInputProps, registerRoot } from 'remotion'
import { VideoComposition } from './VideoComposition'
import '../index.css' // Import Tailwind

// Fallback stub if npx remotion render is called without --props
const defaultProps = {
  videoBrief: {
    title: 'FinPilot Nifty Shorts',
    total_seconds: 15,
    tone: 'neutral',
    scenes: [
      {
        id: 1,
        type: 'intro',
        duration_seconds: 5,
        headline: 'FinPilot Video Engine',
        subline: 'Preparing Nifty 50 Short...',
        visual_type: 'text_reveal',
        transition_type: 'fade',
      }
    ]
  }
}

// Read inputs passed from the CLI
const inputProps = getInputProps()
const videoBrief = inputProps.videoBrief || defaultProps.videoBrief

const FPS = 30
const defaultDuration = Math.max((videoBrief.total_seconds || 15) * FPS, FPS)

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="MainVideo"
        component={VideoComposition}
        durationInFrames={defaultDuration}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{
          videoBrief
        }}
      />
    </>
  )
}

registerRoot(RemotionRoot)
