import { preload } from 'react-dom';
import { defaultSiteContent } from '@boletera/shared';
import { fetchSiteContent, heroSlidesToSrc } from '@/lib/site-content';
import { HomeHero } from './HomeHero';

type HomeHeroRootProps = {
  initialEventCount?: number;
};

export async function HomeHeroRoot({ initialEventCount }: HomeHeroRootProps) {
  const content = await fetchSiteContent();
  const slides = heroSlidesToSrc(
    content.heroSlides.length ? content.heroSlides : defaultSiteContent().heroSlides,
  );

  preload(slides[0].src, { as: 'image', fetchPriority: 'high' });
  if (slides[1]) {
    preload(slides[1].src, { as: 'image', fetchPriority: 'low' });
  }

  return (
    <HomeHero
      slides={slides}
      initialEventCount={initialEventCount}
      headline={content.heroHeadline}
      subcopy={content.heroSubcopy}
    />
  );
}
