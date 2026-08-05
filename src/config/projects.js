import hedgeHopImage from '../assets/hedgehop.webp';
import hedgeHopLearningImage from '../assets/hedgehop2.webp';
import homeLabDashboardImage from '../assets/homelabdash.webp';
import homeLabImage from '../assets/homelabrack.webp';
import touchOfBeautyImage from '../assets/touchofbeauty.webp';
import touchOfBeautyAdminImage from '../assets/touchofbeauty2.webp';

// Add a project by copying one object. Add more photos to its `images` array.
export const projects = [
	{
		slug: 'touch-of-beauty',
		title: 'Touch of Beauty',
		eyebrow: 'Live website',
		description: 'Beauty salon website with services, pricing, team profiles, and Booksy booking.',
		technologies: ['MongoDB', 'Express.js', 'React', 'Node.js'],
		liveUrl: 'https://touchofbeauty.vercel.app',
		source: {
			provider: 'gitlab',
			url: 'https://gitlab.com/gdx160230/dotykpieknauwsb',
			private: true,
		},
		images: [
			{
				src: touchOfBeautyImage,
				alt: 'Touch of Beauty salon website homepage',
			},
			{
				src: touchOfBeautyAdminImage,
				alt: 'Touch of Beauty admin dashboard with content-management modules',
			},
		],
	},
	{
		slug: 'homelab',
		title: 'Self-Hosted Homelab',
		eyebrow: 'Infrastructure lab',
		description: 'Proxmox-based lab for containerized services, reverse proxying, DNS filtering, and infrastructure monitoring.',
		technologies: [
			'Proxmox',
			'Debian',
			'Docker',
			'AdGuard Home',
			'Uptime Kuma',
		],
		images: [
			{
				src: homeLabDashboardImage,
				alt: 'Homelab dashboard showing service status, system metrics, and running containers',
			},
			{
				src: homeLabImage,
				alt: 'Custom homelab rack with compute nodes, networking equipment, and storage',
			},
		],
	},
	{
		slug: 'hedgehop',
		title: 'HedgeHop',
		eyebrow: 'Live website',
		description: 'Language-learning platform with flashcards, lessons, progress tracking, and daily streaks.',
		technologies: ['React', 'JavaScript', 'Tailwind CSS', 'Firebase'],
		liveUrl: 'https://hedgehop.vercel.app',
		source: {
			provider: 'github',
			url: 'https://github.com/adamsiem4/hedgehop',
			private: false,
		},
		images: [
			{
				src: hedgeHopImage,
				alt: 'HedgeHop language-learning dashboard',
			},
			{
				src: hedgeHopLearningImage,
				alt: 'HedgeHop learning interface',
			},
		],
	},
];
