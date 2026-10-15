# Run excalidraw2vsdx with Docker

Docker runs this project in a small Linux environment so you do not have to install Node.js. The same steps work on a Mac with Apple Silicon, a Mac with an Intel chip, Windows, and Linux. The image is built for both `linux/arm64` and `linux/amd64`. On your own computer, `docker build` picks the one that matches your chip.

The container does two jobs. With no extra arguments it serves the web site on port 8080. The convert page still builds the Visio file in your browser. The library page stores uploaded shapes on disk inside the container, draws a PNG preview of each one, and can convert a single library item to Visio. If the first argument is `cli`, it runs the command-line converter instead.

## What Docker is

Docker builds an image (a packed copy of the app and everything it needs to run) and starts a container (a running copy of that image).

## Install Docker

Install Docker Desktop on a Mac or on Windows. On Linux, install Docker Engine. After it is installed, open a terminal (Terminal on macOS, PowerShell or Command Prompt on Windows) and check that the command exists:

```bash
docker --version
```

You should see a line like `Docker version 27.0.0, build ...`. The exact numbers do not matter. If the terminal says `docker: command not found`, Docker is not installed, or the terminal was opened before the installer finished. Close the terminal, open a new one, and try again.

`docker --version` only proves the command is installed. To see whether the Docker app itself is running, use:

```bash
docker info
```

If that prints a long report, you are ready. If it says it cannot connect to the Docker daemon, open Docker Desktop and wait until it says it is running, then try `docker info` again.

### Mac (Apple Silicon and Intel)

1. Click the Apple menu and choose **About This Mac**.
2. If the chip line says **Apple M1**, **M2**, **M3**, **M4**, or **Apple silicon**, you have an Apple Silicon Mac. If it says **Intel**, you have an Intel Mac.
3. Download Docker Desktop from [https://docs.docker.com/desktop/setup/install/mac-install/](https://docs.docker.com/desktop/setup/install/mac-install/). The download page offers the build that matches the chip. Either build of this project’s Dockerfile works; you do not pick a platform flag for a normal install.
4. Open the downloaded `.dmg`, drag Docker to Applications, and open Docker.
5. Accept the privileged-helper prompt. Wait until the whale icon in the menu bar stops animating and Docker says it is running.

### Windows (WSL2)

Docker Desktop on Windows runs Linux containers through WSL2 (Windows Subsystem for Linux, version 2).

1. Download Docker Desktop from [https://docs.docker.com/desktop/setup/install/windows-install/](https://docs.docker.com/desktop/setup/install/windows-install/).
2. Run the installer. When it asks, leave **Use WSL 2 instead of Hyper-V** selected. If Windows asks you to install a WSL update, install it and reboot if Windows tells you to.
3. Start Docker Desktop from the Start menu. Wait until the whale icon says **Docker Desktop is running**.
4. Use **PowerShell** or **Command Prompt** for the commands below. The only difference between them is how you write the current folder in a volume mount, which is called out in the CLI section.

### Linux

Docker Engine is the usual install. The distribution packages differ, so follow the guide for your distro: [https://docs.docker.com/engine/install/](https://docs.docker.com/engine/install/).

On Ubuntu, this is enough to get started:

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"
```

Log out and back in (or reboot) so the group change applies. Until you do, `docker` will say permission denied unless you prefix it with `sudo`. After you log back in, `docker info` should work without `sudo`.

## Get the code

If you have Git:

```bash
git clone https://github.com/powelljustin/excalidraw2vsdx.git
cd excalidraw2vsdx
```

Without Git: on the GitHub page click **Code**, then **Download ZIP**. Unzip it, then in the terminal `cd` into the unzipped folder (the one that contains `Dockerfile`).

## Build the image

From the folder that contains `Dockerfile`:

```bash
docker build -t excalidraw2vsdx .
```

`docker build` reads the Dockerfile and produces an image. `-t excalidraw2vsdx` names that image `excalidraw2vsdx`, which is the name used in every command below. The `.` at the end means “use the current folder as the source.” The first build downloads the Node base image and installs dependencies, so it takes longer than later builds.

On Apple Silicon this image is `linux/arm64`. On an Intel Mac or a typical Windows or Linux PC it is `linux/amd64`. You do not add `--platform` for that. Build once on the machine where you will run it.

## Run the web page

```bash
docker run --rm -p 8080:8080 excalidraw2vsdx
```

Leave that terminal open. In a browser, go to [http://localhost:8080](http://localhost:8080). Drop an `.excalidraw` or `.excalidrawlib` file on the convert page and download the `.vsdx`. That conversion stays in your browser.

**Library** and **Upload** are the other two pages. An upload is saved on the server. The command above uses `--rm`, which throws the container away when you stop it, and the library files go with it. Use a volume, below, if you want the library to still be there tomorrow.

What the flags mean:

- `docker run` starts a new container from the image.
- `--rm` deletes that container when you stop it, so you do not collect leftover containers.
- `-p 8080:8080` publishes a port. The number on the left is the port on your computer. The number on the right is the port inside the container. Here they are the same, so the page is at port 8080.
- `excalidraw2vsdx` is the image name from the build step.

Press `Ctrl+C` in the terminal to stop the page.

## Keep uploaded libraries

The image stores the catalog at `/data/library` inside the container. That path is controlled by the `DATA_DIR` environment variable, which the image already sets to `/data/library`. A Docker volume is a place Docker keeps for you, separate from the container. When you attach one to `/data/library`, uploads, PNG previews, and the catalog file `index.json` stay on your computer after the container stops.

Give the volume a name you can recognize, `excalidraw2vsdx-library`:

```bash
docker run --rm -p 8080:8080 -v excalidraw2vsdx-library:/data/library excalidraw2vsdx
```

`-v excalidraw2vsdx-library:/data/library` means “keep a volume called `excalidraw2vsdx-library`, and show it to the container as `/data/library`.” `--rm` still deletes the container. It does not delete a named volume. The next `docker run` with the same `-v` name sees the same libraries.

You can also use a normal folder, which is easier to find in Finder or File Explorer. From the project folder:

macOS, Linux, and PowerShell:

```bash
mkdir -p library-data
docker run --rm -p 8080:8080 -v "$PWD/library-data":/data/library excalidraw2vsdx
```

Windows Command Prompt:

```cmd
mkdir library-data
docker run --rm -p 8080:8080 -v "%cd%\library-data":/data/library excalidraw2vsdx
```

The folder `library-data` now contains `index.json` and a `libraries` directory. Do not rename files inside it while the container is running.

### Who can upload

There is no login. On a computer that only you can reach, that is fine. If other people can open the site, set an admin token so only you can upload, edit, or delete:

```bash
docker run --rm -p 8080:8080 \
  -e ADMIN_TOKEN=replace-this-with-a-long-random-string \
  -v excalidraw2vsdx-library:/data/library \
  excalidraw2vsdx
```

Pick your own long random string. Do not commit it, and do not put a real one in `docker-compose.yml` if that file is in git. Type the same string into the **Admin token** field on the Upload and Library pages. Leave `ADMIN_TOKEN` unset and those actions stay open.

`MAX_UPLOAD_BYTES` limits how big an upload can be. The default is 20971520 (20 MB).

Libraries are `free` unless you choose `paid` on the upload form. Paid means the name can be listed, and the pictures and downloads stay hidden. This version does not collect payment. Use Free unless you are trying that flag.

### Back up the data folder

The thing you want a copy of is the whole data directory: `index.json` plus the `libraries` folder. Stop the container first so nothing is writing the catalog while you copy it. `Ctrl+C` stops a foreground container. `docker compose stop` stops the Compose one.

If you used a folder (`library-data` next to the project), zip that folder.

macOS, Linux, and PowerShell:

```bash
tar czf library-backup.tar.gz -C library-data .
```

Windows Command Prompt can copy the folder instead:

```cmd
xcopy library-data library-backup\ /E /I
```

That archive is the backup. Copy it somewhere else (another disk, or a cloud drive). To put it back, stop the container, empty `library-data`, and extract the archive into it:

```bash
tar xzf library-backup.tar.gz -C library-data
```

Then start the container again with the same volume mount.

If you used the named volume `excalidraw2vsdx-library`, Docker is holding the files. This copies them into `library-backup.tar.gz` in the current folder:

```bash
docker run --rm -v excalidraw2vsdx-library:/data -v "$PWD":/backup alpine tar czf /backup/library-backup.tar.gz -C /data .
```

Restore that named volume (this replaces what is in the volume):

```bash
docker run --rm -v excalidraw2vsdx-library:/data -v "$PWD":/backup alpine sh -c "find /data -mindepth 1 -delete && tar xzf /backup/library-backup.tar.gz -C /data"
```

Compose creates its own volume name, usually `excalidraw2vsdx_library-data`. Run `docker volume ls` and use the name you see in place of `excalidraw2vsdx-library` in the commands above.

`docker compose down -v` deletes that volume and the libraries in it. `docker compose down` without `-v` does not.

## Convert a file with the CLI

Put the drawing in the folder you are in, or `cd` to the folder that already contains it. This example expects a file named `in.excalidraw` in that folder and writes `out.vsdx` next to it.

macOS, Linux, and PowerShell:

```bash
docker run --rm -v "$PWD":/data excalidraw2vsdx cli /data/in.excalidraw -o /data/out.vsdx
```

Windows Command Prompt (`cmd.exe`):

```cmd
docker run --rm -v "%cd%:/data" excalidraw2vsdx cli /data/in.excalidraw -o /data/out.vsdx
```

What each piece means:

- `docker run` starts a container and, because of `--rm`, removes it when the conversion finishes.
- `--rm` deletes the container afterward. Your `out.vsdx` is not inside the container. It is written into the mounted folder, so it stays on your computer.
- `-v` mounts a folder. `"$PWD":/data` (or `"%cd%:/data"` in Command Prompt) means “take the folder I am in right now, and show it to the container as `/data`.” `$PWD` is the current folder in macOS, Linux, and PowerShell. `%cd%` is the same thing in Command Prompt. Paths *inside* the container always use forward slashes and start with `/data`. Do not put `C:\...` after `cli`.
- `excalidraw2vsdx` is the image.
- `cli` tells this image to run the converter instead of the web page.
- `/data/in.excalidraw` is the input file, as the container sees it.
- `-o /data/out.vsdx` is the converter’s own output flag. `-o` means “write the Visio file here.” Because the path is under `/data`, the file appears in your current folder as `out.vsdx`.

A concrete PowerShell example, if the drawing is on your Desktop:

```powershell
cd $env:USERPROFILE\Desktop
docker run --rm -v "${PWD}:/data" excalidraw2vsdx cli /data/diagram.excalidraw -o /data/diagram.vsdx
```

The same idea in Command Prompt:

```cmd
cd %USERPROFILE%\Desktop
docker run --rm -v "%cd%:/data" excalidraw2vsdx cli /data/diagram.excalidraw -o /data/diagram.vsdx
```

Other converter flags work after the file name: `--px-per-inch 96` and `--margin 0.5`. To see them:

```bash
docker run --rm excalidraw2vsdx cli --help
```

## Docker Compose

Compose is a small config file, `docker-compose.yml`, that remembers the image name, the port, the library volume, and the restart rule. The volume is named `library-data` in the file. Compose adds the project name in front, so `docker volume ls` shows something like `excalidraw2vsdx_library-data`. That volume is mounted at `/data/library` inside the container. From the project folder:

```bash
docker compose up --build
```

That builds if needed and runs the web page in the foreground. Open [http://localhost:8080](http://localhost:8080). `Ctrl+C` stops it.

To run it in the background:

```bash
docker compose up -d --build
```

`-d` means detached: the terminal prompt comes back, and the page keeps running. The compose file sets `restart: unless-stopped`. After a reboot, Docker starts the page again. If you stop it yourself, it stays stopped until you start it again. That is what “unless stopped” means.

Stop the background page, but keep the container so you can start it later:

```bash
docker compose stop
docker compose start
```

Stop it and remove the container (the image remains, so the next start is quick). The library volume is kept:

```bash
docker compose down
```

`docker compose down -v` also deletes the library volume. Do not add `-v` unless you mean to throw the uploaded libraries away. Back them up first if you are not sure.

Remove the container and the image built by this compose file:

```bash
docker compose down --rmi local
```

## Run in the background without Compose

This is the same idea as `docker compose up -d`, written out as one `docker run`:

```bash
docker run -d --name excalidraw2vsdx --restart unless-stopped -p 8080:8080 -v excalidraw2vsdx-library:/data/library excalidraw2vsdx
```

- `-d` runs in the background.
- `--name excalidraw2vsdx` names the container so the stop commands below have something to point at.
- `--restart unless-stopped` starts it again when Docker starts, unless you have stopped it yourself.

Stop it:

```bash
docker stop excalidraw2vsdx
```

Start that same container again:

```bash
docker start excalidraw2vsdx
```

Remove the stopped container:

```bash
docker rm excalidraw2vsdx
```

Remove the image (only after no container is using it):

```bash
docker rmi excalidraw2vsdx
```

`docker ps` lists containers that are running. `docker ps -a` also lists stopped ones. `docker images` lists images.

## Update to a new version

If you cloned with Git:

```bash
git pull
docker compose up -d --build
```

`git pull` downloads the new source. `--build` rebuilds the image so the running page matches that source.

If you downloaded a ZIP, download the new ZIP, unzip it, `cd` into the new folder, and run `docker compose up -d --build` again. If an older container is still holding port 8080, stop it first (`docker compose down` in the old folder, or `docker stop excalidraw2vsdx`).

## Troubleshooting

### Port 8080 is already in use

Something else on your computer is using port 8080, or an older copy of this container is still running.

See what is running:

```bash
docker ps
```

Stop a previous copy:

```bash
docker stop excalidraw2vsdx
```

Or publish a different port on your computer. The container can stay on 8080 internally:

```bash
docker run --rm -p 8081:8080 excalidraw2vsdx
```

Open [http://localhost:8081](http://localhost:8081). With Compose, change the left number in `docker-compose.yml` from `"8080:8080"` to `"8081:8080"` and run `docker compose up --build` again.

On macOS or Linux, `lsof -i :8080` shows which program has the port. On Windows, `netstat -ano | findstr :8080` does the same.

### Docker is not running

`docker --version` can succeed even when the Docker app is stopped. `docker info` or `docker ps` will fail with a message about the daemon or the pipe.

- Mac or Windows: open **Docker Desktop** and wait until it says it is running. The first start after a reboot can take a minute.
- Linux with systemd: `sudo systemctl start docker`.

Then run the command again.

### Permission denied

On Linux, `permission denied` while talking to `/var/run/docker.sock` means your user is not in the `docker` group. Run the `usermod` command from the Linux install section, then log out and back in. `sudo docker ...` works in the meantime.

If the CLI says it cannot write `out.vsdx`, you are probably not mounting the folder you think you are. `cd` to the folder that contains the drawing, and keep both the input and the `-o` path under `/data`. On Linux, a file created by the container may be owned by root. You can still open it. To take ownership: `sudo chown "$USER" out.vsdx`.

The same applies to a `library-data` folder used as the library volume. If an upload fails and the container log says it cannot write the directory, the folder may be owned by another user. `sudo chown -R "$USER" library-data` from the project folder fixes a folder you created yourself. A named volume (`excalidraw2vsdx-library`) does not have this problem.

### Apple Silicon

A normal `docker build` on Apple Silicon produces an arm64 image and runs it natively. Leave out `--platform`.

Add a platform only when you mean to build for a different chip. For an Intel image from an Apple Silicon Mac (Docker Desktop must have emulation enabled):

```bash
docker buildx build --platform linux/amd64 -t excalidraw2vsdx --load .
```

If a container exits immediately and `docker logs` mentions `exec format error`, the image was built for the other chip. Rebuild with `docker build -t excalidraw2vsdx .` and do not pass `--platform`.

### Upload says it requires an admin token

The server was started with `ADMIN_TOKEN` set. Type that same value into the Admin token field and submit again. If you do not know the value, it is only in the command or the Compose environment you used to start the container. It is not stored in the library.

### The page does not load

Confirm the container is running with `docker ps`. If it is not listed, the process exited; start it again and read the terminal output. Use `http://localhost:8080`, not `https://`. If you mapped a different host port, use that port instead.

### The CLI cannot find the file

The converter only sees files under `/data`, and `/data` is the folder you mounted. A path like `/Users/you/Desktop/in.excalidraw` or `C:\Users\you\in.excalidraw` is a path on your computer, not a path inside the container. `cd` to that file’s folder and use `/data/in.excalidraw`.
