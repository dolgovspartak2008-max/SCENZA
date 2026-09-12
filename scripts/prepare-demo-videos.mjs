import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'public', 'videos');
const cache = join(root, 'tmp', 'video-sources');
const movies = [
  {
    id: 'tihiy-gorod', file: 'city.mp4', image: 'city.jpg', title: 'Тихий город',
    sourceCredit: 'Tears of Steel · © Blender Foundation · mango.blender.org · CC BY 3.0 · фрагмент',
    sourceUrl: 'https://mango.blender.org/', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    downloadUrl: 'https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov',
    start: 240,
  },
  {
    id: 'za-gorizontom', file: 'coast.mp4', image: 'coast.jpg', title: 'За горизонтом',
    sourceCredit: 'Big Buck Bunny · © 2008 Blender Foundation · www.bigbuckbunny.org · CC BY 3.0 · фрагмент',
    sourceUrl: 'https://peach.blender.org/', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    downloadUrl: 'https://download.blender.org/peach/bigbuckbunny_movies/big_buck_bunny_720p_h264.mov.zip',
    archiveMember: 'big_buck_bunny_720p_h264.mov', start: 120,
  },
  {
    id: 'posledniy-reys', file: 'ship.mp4', image: 'ship.jpg', title: 'Последний рейс',
    sourceCredit: 'Elephants Dream · © 2006 Blender Foundation / Netherlands Media Art Institute · www.elephantsdream.org · CC BY 2.5 · фрагмент',
    sourceUrl: 'https://orange.blender.org/', licenseUrl: 'https://creativecommons.org/licenses/by/2.5/',
    downloadUrl: 'https://download.blender.org/ED/elephantsdream-720-h264-st-aac.mov',
    start: 80,
  },
  {
    id: 'do-rassveta', file: 'dawn.mp4', image: 'dawn.jpg', title: 'До рассвета',
    sourceCredit: 'Sintel · © Blender Foundation · www.sintel.org · CC BY 3.0 · фрагмент',
    sourceUrl: 'https://durian.blender.org/', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    downloadUrl: 'https://download.blender.org/durian/movies/Sintel.2010.1080p.mkv',
    start: 150,
  },
];

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${binary} failed (${code}): ${stderr}`)));
  });
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function inputFor(movie) {
  if (!movie.archiveMember) return movie.downloadUrl;
  const extracted = join(cache, movie.archiveMember);
  if (await exists(extracted)) return extracted;
  const archive = `${extracted}.zip`;
  if (!await exists(archive)) {
    console.log(`Downloading ${movie.archiveMember}.zip`);
    const response = await fetch(movie.downloadUrl, { signal: AbortSignal.timeout(15 * 60_000) });
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(`${archive}.part`));
    await rename(`${archive}.part`, archive);
  }
  // Extract only the known movie member; never archive-supplied paths.
  await run('tar', ['-xf', archive, '-C', cache, movie.archiveMember]);
  return extracted;
}

await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });
await access(ffmpeg);
for (const movie of movies) {
  const destination = join(output, movie.file);
  const input = await inputFor(movie);
  console.log(`Preparing ${movie.file}`);
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(movie.start), '-i', input,
    '-t', '40', '-map', '0:v:0', '-map', '0:a:0', '-map_chapters', '-1', '-map_metadata', '-1',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '25', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-b:a', '128k', '-movflags', '+faststart', '-write_tmcd', '0',
    '-metadata', `comment=${movie.sourceCredit} | ${movie.sourceUrl} | ${movie.licenseUrl}`,
    destination,
  ]);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '8', '-i', destination, '-frames:v', '1', '-q:v', '2', join(output, movie.image)]);
  const metadata = JSON.parse(await run(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', destination]));
  if (!metadata.streams.some(stream => stream.codec_name === 'h264') ||
      !metadata.streams.some(stream => stream.codec_name === 'aac') ||
      Math.abs(Number(metadata.format.duration) - 40) > 0.2) {
    throw new Error(`Invalid demo video: ${movie.file}`);
  }
  console.log(`${movie.file}: ${metadata.format.duration}s, ${Math.round(Number(metadata.format.size) / 1024)} KiB, H.264/AAC`);
}
await writeFile(join(output, 'sources.json'), `${JSON.stringify(movies.map(({ archiveMember, ...movie }) => movie), null, 2)}\n`);
