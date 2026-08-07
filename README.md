<div align="center">

# Adam Salicki's Portfolio

A minimal, mobile-first portfolio for web, infrastructure, and hardware projects.

[![Astro](https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white)](https://astro.build)
[![Bun](https://img.shields.io/badge/Bun-runtime-14151A?logo=bun&logoColor=white)](https://bun.sh)
[![Live site](https://img.shields.io/badge/Live-adamsalicki.pages.dev-08665F)](https://adamsalicki.pages.dev)

</div>

## Features

- Responsive project deck with per-project image galleries
- Dark and light themes with a View Transitions reveal effect
- Magnetic interactions, kinetic text, and a custom page loader
- Reduced-motion fallbacks and accessible controls
- Optimized local images through Astro's asset pipeline

## Technical overview

| Area | Implementation |
| --- | --- |
| Framework | Astro 7 with statically rendered `.astro` components |
| Client behavior | Modular plain JavaScript without a UI framework |
| Styling | Mobile-first component CSS with shared theme variables |
| Icons | Lucide for interface icons and Simple Icons for technologies |
| Images | Local WebP assets processed by `astro:assets` |
| Runtime | Bun for dependency management and project scripts |
| Hosting | Static deployment on Cloudflare Pages |

Project content is stored in `src/config/projects.js`, while reusable project markup,
technology icon mappings, and responsive media handling live in
`src/components/ProjectCard.astro`.
