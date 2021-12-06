

class Pusher {
    constructor() {
        this.aencoder_ = null;
        this.vencoder_ = null;
        this.videoElement_ = null;
       
        
        this.pc_ = null;
        this.datachannel_ = null;
        this.channelOpen_ = false;

        this.sendFrames_ = 0;
        this.videoGop_ = 30;  
    }
    async init(videoElement) {

        this.pc_ = new RTCPeerConnection();
        this.datachannel_ = this.pc_.createDataChannel('message',{ordered:true});
        this.datachannel_.binaryType = 'arraybuffer';
        this.datachannel_.onopen = () => {
            console.log('datachannel open');
            this.channelOpen_ = true;
        };
        this.datachannel_.onmessage = (event) => {
            console.log('datachannel message');
            console.log(event.data);
        };

        const offer = await this.pc_.createOffer();
        await this.pc_.setLocalDescription(offer);


        console.log(offer.sdp);

        let res = await fetch("http://localhost:8000/pub", {
            method: 'post',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sdp: offer.sdp
            })
        })

        console.dir(res)

    
        let ret = await res.json()

        let answer = new RTCSessionDescription({
            type: 'answer',
            sdp: ret.sdp
        })

        await this.pc_.setRemoteDescription(answer);

        const constraints = {
            video: { width: { exact: 1280 }, height: { exact: 720 } },
            audio: {
                channelCount:2,
                sampleRate:48000,
            }
        }

        // VideoEncoder config 
        this.vencoder_ = new VideoEncoder({
            output: this.handleVideoEncoded.bind(this),
            error: (error) => {
                console.error("video encoder " + error);
            }
        });
        this.vencoder_.configure({ codec: 'vp8', width: 1289, height: 720 });

       

        // AudioEncoder config 
        this.aencoder_ = new AudioEncoder({
            output: this.handleAudioEncoded.bind(this),
            error: (error) => {
                console.error("audio encoder " + error);
            }
        });
        this.aencoder_.configure({ codec: 'opus', numberOfChannels: 2, sampleRate: 48000 });
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);

        let vprocessor = new MediaStreamTrackProcessor(stream.getVideoTracks()[0]);
        let vgenerator = new MediaStreamTrackGenerator('video');
        const vsource = vprocessor.readable;
        const vsink = vgenerator.writable;
        let vtransformer = new TransformStream({ transform: this.videoTransform() });
        vsource.pipeThrough(vtransformer).pipeTo(vsink);


        let aprocessor = new MediaStreamTrackProcessor(stream.getAudioTracks()[0]);
        let agenerator = new MediaStreamTrackGenerator('audio');
        const asource = aprocessor.readable;
        const asink = agenerator.writable;
        let atransformer = new TransformStream({ transform: this.audioTransform() });
        asource.pipeThrough(atransformer).pipeTo(asink);


        let processedStream = new MediaStream();
        processedStream.addTrack(vgenerator);
        processedStream.addTrack(agenerator);
        videoElement.srcObject = processedStream;
        await videoElement.play();
    }

    videoTransform(frame, controller) {

        return (frame, controller) => {
           
            const insert_keyframe = (this.sendFrames_ % 30) == 0;
            this.sendFrames_++;
            if (insert_keyframe) {
                console.log('keyframe == ');
            }
            this.vencoder_.encode(frame, { keyFrame: insert_keyframe });
            controller.enqueue(frame);
        }

    }

    audioTransform() {
        return (frame, controller) => {
            this.aencoder_.encode(frame);
            controller.enqueue(frame);
        }
 
    }

    async handleVideoEncoded(chunk) {


        let data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data.buffer);
        const { type, timestamp, duration } = chunk;
        let kind = 'video';
        let data_ = CBOR.encode({
                kind,
                type,
                timestamp,
                duration,
                data: data,
            });
        if (this.channelOpen_) {
            this.datachannel_.send(data_);
        }
       
    }

    async handleAudioEncoded(chunk) {


        let data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data.buffer);
        let kind = 'audio';
        const {type,timestamp} = chunk;
        let data_ = CBOR.encode({
            kind,
            type,
            timestamp,
            data: data,
        });
        if (this.channelOpen_) {
            this.datachannel_.send(data_);
        }
       
    }

    destroy() {
        if (this.datachannel_) {
            this.datachannel_.close();
            this.datachannel_ = null;
            this.channelOpen_ = false;
        }
    }
}