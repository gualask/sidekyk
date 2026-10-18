# A Linux box that stands in for a WSL distro: an ordinary uid-1000 account owning a repository on
# the Linux filesystem, edited from inside. See docs/container-testing.md.

# Ubuntu because it is WSL's default distro. Pinned by digest (a multi-arch index: amd64 and arm64)
# so a rebuild cannot move git under the fixture. To bump: `docker pull ubuntu:24.04`, then
# `docker image inspect ubuntu:24.04 --format '{{index .RepoDigests 0}}'`.
#
# ubuntu:24.04 (24.04.5 LTS), git 2.43
FROM ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac

# git for the repository, inotify-tools for `watch`: the events a watcher inside would see.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git inotify-tools \
	&& rm -rf /var/lib/apt/lists/*

COPY seed.sh /usr/local/bin/fixture-seed.sh
RUN chmod 755 /usr/local/bin/fixture-seed.sh

# The image's own `ubuntu` account (uid 1000), as the first user WSL creates. The project folder
# exists in the image so the named volume mounted on it starts owned by that account.
USER ubuntu
RUN mkdir /home/ubuntu/project
WORKDIR /home/ubuntu/project

CMD ["sh", "-c", "fixture-seed.sh && exec sleep infinity"]
