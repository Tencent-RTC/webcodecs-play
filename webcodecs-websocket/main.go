package main

import (
	"fmt"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upGrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

var pubws *websocket.Conn
var subwss sync.Map

func pubChannel(c *gin.Context) {
	var err error
	pubws, err = upGrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer pubws.Close()

	for {
		messageType, p, err := pubws.ReadMessage()
		if err != nil {
			fmt.Println("error ", err)
			return
		}

		subwss.Range(func(k, _ interface{}) bool {
			s := k.(*websocket.Conn)
			s.WriteMessage(messageType, p)
			return true
		})
	}
}

func subChannel(c *gin.Context) {
	subws, err := upGrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer subws.Close()

	subwss.Store(subws, "")

	for {
		_, _, err = subws.ReadMessage()

		if err != nil {
			fmt.Println("error ", err)
			break
		}
	}

	subwss.Delete(subws)
}

func index(c *gin.Context) {
	c.HTML(http.StatusOK, "index.html", gin.H{})
}

func main() {

	address := ":8000"
	r := gin.Default()
	r.LoadHTMLFiles("./index.html")
	r.StaticFile("/pusher.js", "./pusher.js")
	r.StaticFile("/player.js", "./player.js")
	r.StaticFile("/cbor.js", "./cbor.js")
	r.GET("/", index)

	r.GET("/pub", pubChannel)
	r.GET("/sub", subChannel)

	r.Run(address)
}
