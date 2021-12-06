package main

import (
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/pion/webrtc/v3"
)

var pubChan *webrtc.DataChannel
var subChans sync.Map

func pubChannel(c *gin.Context) {

	var data struct {
		Sdp string `json:"sdp"`
	}

	if err := c.ShouldBind(&data); err != nil {
		c.JSON(200, gin.H{"s": 10001, "e": err})
		return
	}

	var config = webrtc.Configuration{
		ICEServers:   []webrtc.ICEServer{},
		BundlePolicy: webrtc.BundlePolicyMaxBundle,
		SDPSemantics: webrtc.SDPSemanticsUnifiedPlan,
	}

	peerConnection, err := webrtc.NewPeerConnection(config)

	if err != nil {
		panic(err)
	}

	peerConnection.OnDataChannel(func(dc *webrtc.DataChannel) {

		pubChan = dc

		dc.OnOpen(func() {
			log.Printf("OnOpen: %s-%d.  Pub Datachannel ", dc.Label(), dc.ID())
		})

		// Register the OnMessage to handle incoming messages
		dc.OnMessage(func(dcMsg webrtc.DataChannelMessage) {

			subChans.Range(func(key, _ interface{}) bool {

				datachan := key.(*webrtc.DataChannel)
				datachan.Send(dcMsg.Data)
				return true
			})
		})
	})

	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  data.Sdp,
	}

	err = peerConnection.SetRemoteDescription(offer)
	if err != nil {
		panic(err)
	}
	answer, err := peerConnection.CreateAnswer(nil)
	if err != nil {
		fmt.Println(err)
		panic(err)
	}
	peerConnection.SetLocalDescription(answer)

	gatherComplete := webrtc.GatheringCompletePromise(peerConnection)

	<-gatherComplete

	c.JSON(200, gin.H{
		"sdp": peerConnection.LocalDescription().SDP,
	})

}

func subChannel(c *gin.Context) {

	var data struct {
		Sdp string `json:"sdp"`
	}

	if err := c.ShouldBind(&data); err != nil {
		c.JSON(200, gin.H{"s": 10001, "e": err})
		return
	}

	var config = webrtc.Configuration{
		ICEServers:   []webrtc.ICEServer{},
		BundlePolicy: webrtc.BundlePolicyMaxBundle,
		SDPSemantics: webrtc.SDPSemanticsUnifiedPlan,
	}

	peerConnection, err := webrtc.NewPeerConnection(config)

	if err != nil {
		panic(err)
	}

	peerConnection.OnDataChannel(func(dc *webrtc.DataChannel) {

		subChan := dc

		subChans.Store(subChan, "")

		dc.OnOpen(func() {
			log.Printf("OnOpen: %s-%d. Sub Datachannel", dc.Label(), dc.ID())
		})

		// Register the OnMessage to handle incoming messages
		dc.OnMessage(func(dcMsg webrtc.DataChannelMessage) {
		})

		dc.OnClose(func() {
			subChans.Delete(subChan)
		})
	})

	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  data.Sdp,
	}

	err = peerConnection.SetRemoteDescription(offer)
	if err != nil {
		panic(err)
	}
	answer, err := peerConnection.CreateAnswer(nil)
	if err != nil {
		fmt.Println(err)
		panic(err)
	}
	peerConnection.SetLocalDescription(answer)

	gatherComplete := webrtc.GatheringCompletePromise(peerConnection)

	<-gatherComplete

	c.JSON(200, gin.H{
		"sdp": peerConnection.LocalDescription().SDP,
	})

	// subws, err := upGrader.Upgrade(c.Writer, c.Request, nil)
	// if err != nil {
	// 	return
	// }
	// defer subws.Close()

	// subwss.Store(subws, "")

	// for {
	// 	_, _, err = subws.ReadMessage()

	// 	if err != nil {
	// 		fmt.Println("error ", err)
	// 		break
	// 	}
	// }

	// subwss.Delete(subws)
}

func index(c *gin.Context) {
	c.HTML(http.StatusOK, "index.html", gin.H{})
}

func main() {

	address := ":8000"
	r := gin.Default()

	corsc := cors.DefaultConfig()
	corsc.AllowAllOrigins = true
	corsc.AllowCredentials = true
	r.Use(cors.New(corsc))

	r.LoadHTMLFiles("./index.html")
	r.StaticFile("/pusher.js", "./pusher.js")
	r.StaticFile("/player.js", "./player.js")
	r.StaticFile("/cbor.js", "./cbor.js")
	r.GET("/", index)

	r.GET("/pub", pubChannel)
	r.GET("/sub", subChannel)

	r.Run(address)
}
