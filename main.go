package main

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upGrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

var pubws *websocket.Conn

func channel(c *gin.Context) {
	var err error
	pubws, err = upGrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer pubws.Close()

	for {
		messageType, p, err := pubws.ReadMessage()
		fmt.Println("message Type ", messageType, len(p))
		if err != nil {
			fmt.Println("err ", err)
			return
		}

		err = pubws.WriteMessage(messageType, p)
		if err != nil {
			fmt.Println("err ", err)
			return
		}
	}
}

func index(c *gin.Context) {
	c.HTML(http.StatusOK, "index.html", gin.H{})
}

func main() {

	address := ":8000"
	r := gin.Default()
	r.LoadHTMLFiles("./index.html")
	r.GET("/", index)

	r.GET("/channel", channel)

	r.Run(address)
}
