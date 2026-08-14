interface ImageDimensions {
	width: number;
	height: number;
}

export const PROJECT_LAYOUT = Object.freeze({
	contentMaxWidth: 1_152,
	mobilePageGutter: 20,
	tabletPageGutter: 32,
	tabletBreakpoint: 768,
	desktopBreakpoint: 1_200,
	desktopMaxBreakpointRem: 76,
	desktopMediaShare: 17 / 24,
	cardInlineBorders: 2,
	desktopMediaDivider: 1,
	deckReserveBase: 32,
	deckReserveStep: 12,
	deckReserveMaximum: 88,
});

const formatSize = (value: number) => Number(value.toFixed(4));

export const getProjectDeckReserve = (projectCount: number) => {
	const normalizedCount = Math.max(0, Math.floor(projectCount));

	return Math.min(
		PROJECT_LAYOUT.deckReserveMaximum,
		PROJECT_LAYOUT.deckReserveBase
			+ (Math.max(0, normalizedCount - 1) * PROJECT_LAYOUT.deckReserveStep),
	);
};

export const getProjectMaximumCardOffset = (projectCount: number) => {
	const normalizedCount = Math.max(0, Math.floor(projectCount));

	return normalizedCount < 2 ? 0 : 12 + ((normalizedCount - 2) * 10);
};

export const getProjectMediaSlotWidth = (
	deckWidth: number,
	projectCount: number,
	isDesktop: boolean,
) => {
	const cardContentWidth = Math.max(
		0,
		deckWidth - getProjectDeckReserve(projectCount) - PROJECT_LAYOUT.cardInlineBorders,
	);

	if (!isDesktop) return cardContentWidth;

	return Math.max(
		0,
		(cardContentWidth * PROJECT_LAYOUT.desktopMediaShare)
			- PROJECT_LAYOUT.desktopMediaDivider,
	);
};

export const getProjectImageSizes = (
	{ width, height }: ImageDimensions,
	projectCount: number,
) => {
	const containScale = Math.min(1, (width * 9) / (height * 16));
	const reserve = getProjectDeckReserve(projectCount);
	const viewportShare = formatSize(containScale * 100);
	const desktopViewportShare = formatSize(
		containScale * PROJECT_LAYOUT.desktopMediaShare * 100,
	);
	const mobileOffset = formatSize(containScale * (
		(PROJECT_LAYOUT.mobilePageGutter * 2)
		+ reserve
		+ PROJECT_LAYOUT.cardInlineBorders
	));
	const tabletOffset = formatSize(containScale * (
		(PROJECT_LAYOUT.tabletPageGutter * 2)
		+ reserve
		+ PROJECT_LAYOUT.cardInlineBorders
	));
	const desktopOffset = formatSize(containScale * (
		(
			(PROJECT_LAYOUT.tabletPageGutter * 2)
			+ reserve
			+ PROJECT_LAYOUT.cardInlineBorders
		) * PROJECT_LAYOUT.desktopMediaShare
		+ PROJECT_LAYOUT.desktopMediaDivider
	));
	const desktopMaximum = formatSize(containScale * (
		(
			PROJECT_LAYOUT.contentMaxWidth
			- reserve
			- PROJECT_LAYOUT.cardInlineBorders
		) * PROJECT_LAYOUT.desktopMediaShare
		- PROJECT_LAYOUT.desktopMediaDivider
	));

	return [
		`(min-width: ${PROJECT_LAYOUT.desktopMaxBreakpointRem}rem) ${desktopMaximum}px`,
		`(min-width: ${PROJECT_LAYOUT.desktopBreakpoint / 16}rem) calc(${desktopViewportShare}vw - ${desktopOffset}px)`,
		`(min-width: ${PROJECT_LAYOUT.tabletBreakpoint / 16}rem) calc(${viewportShare}vw - ${tabletOffset}px)`,
		`calc(${viewportShare}vw - ${mobileOffset}px)`,
	].join(', ');
};
