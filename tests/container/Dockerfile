# A Linux box that stands in for a WSL distro: an ordinary uid-1000 account owning a repository on
# the Linux filesystem, edited from inside. The same image builds and tests the core and the helper
# on Linux (`scripts/container-fixture.sh test`): one image for both. See docs/testing.md.

# Ubuntu because it is WSL's default distro. Pinned by digest (a multi-arch index: amd64 and arm64)
# so a rebuild cannot move git under the fixture. To bump: `docker pull ubuntu:24.04`, then
# `docker image inspect ubuntu:24.04 --format '{{index .RepoDigests 0}}'`.
#
# ubuntu:24.04 (24.04.5 LTS), git 2.43
FROM ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac

# git for the repository, inotify-tools for `watch`: the events a watcher inside would see. gcc
# and the C library's headers for the crates that build C (oniguruma), curl for rustup.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git inotify-tools gcc libc6-dev curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Rust at the version the Mac builds with, the minimal profile (no docs, no clippy). The crates'
# sources come from the Mac's ~/.cargo/registry and the builds go to src-tauri/target/linux on the
# Mac, both mounted by `test`: nothing grows inside the image or the VM.
ARG RUST_VERSION=1.99.0
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo PATH=/opt/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
	| sh -s -- -y --no-modify-path --profile minimal --default-toolchain "$RUST_VERSION" \
	&& chown -R ubuntu:ubuntu /opt/rustup /opt/cargo

COPY seed.sh /usr/local/bin/fixture-seed.sh
RUN chmod 755 /usr/local/bin/fixture-seed.sh

# The image's own `ubuntu` account (uid 1000), as the first user WSL creates. The project folder
# exists in the image so the named volume mounted on it starts owned by that account.
USER ubuntu
RUN mkdir /home/ubuntu/project
WORKDIR /home/ubuntu/project

CMD ["sh", "-c", "fixture-seed.sh && exec sleep infinity"]
